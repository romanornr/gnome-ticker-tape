import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {isLiveCryptoTicker} from '../../utils/asset-categories.js';

const LIVE_CRYPTO_RECONNECT_DELAYS_SECONDS = [2, 5, 10, 20, 30, 60];
const LIVE_SILENCE_TIMEOUT_SECONDS = 60;
const LIVE_WATCHDOG_INTERVAL_SECONDS = 15;
const NOOP = () => {};

/* Soup's callback-style websocket handshake becomes the cancellable promise used by the shared lifecycle. */
function openWebsocketConnection(session, websocketUrl, cancellable) {
    const message = Soup.Message.new('GET', websocketUrl);
    return new Promise((resolve, reject) => {
        session.websocket_connect_async(message, null, [], GLib.PRIORITY_DEFAULT, cancellable, (_session, result) => {
            try {
                resolve(session.websocket_connect_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

/*
 * Live providers share this websocket lifecycle while retaining their own REST
 * polling, subscription payload, and quote parsing. A generation-owned pending
 * handshake guarantees that subscription changes cannot orphan or adopt a
 * stale socket, and every transport failure follows one recovery path.
 */
export class LiveWebsocketProvider {
    constructor({
        id,
        name,
        websocketUrl,
        uuid,
        onQuotes = NOOP,
        onStale = NOOP,
        connectWebsocket = openWebsocketConnection,
    }) {
        this.id = id;
        this._name = name;
        this._websocketUrl = websocketUrl;
        this._uuid = uuid;
        this._onQuotes = onQuotes;
        this._onStale = onStale;
        this._connectWebsocket = connectWebsocket;
        this._session = null;
        this._tickers = [];
        this._websocket = null;
        this._websocketSignalIds = [];
        this._pendingConnection = null;
        this._connectionGeneration = 0;
        this._reconnectTimeoutId = 0;
        this._reconnectAttempt = 0;
        this._subscribedSymbols = [];
        this._watchdogTimeoutId = 0;
        this._lastMessageUsec = 0;
        this._transportFailureReported = false;
        this._payloadFailureReported = false;
    }

    start(session) {
        if (this._session)
            return;

        this._session = session;
        this._transportFailureReported = false;
        this._payloadFailureReported = false;
        void this._connectIfNeeded();
    }

    stop() {
        this._session = null;
        this._cancelPendingConnection();
        this._tickers = [];
        this._subscribedSymbols = [];
        this._reconnectAttempt = 0;
        this._transportFailureReported = false;
        this._payloadFailureReported = false;
        this._reconnectTimeoutId = removeTimeout(this._reconnectTimeoutId);
        this._disconnectWebsocket();
    }

    updateSubscriptions(tickers) {
        this._tickers = tickers.filter(ticker => this.ownsTicker(ticker));

        const desiredSymbols = this._getDesiredSymbols();
        const desiredSignature = createSymbolSignature(desiredSymbols);
        if (desiredSymbols.length === 0) {
            this._reconnectTimeoutId = removeTimeout(this._reconnectTimeoutId);
            this._reconnectAttempt = 0;
            this._cancelPendingConnection();
            this._disconnectWebsocket();
            return;
        }

        if (this._websocket && createSymbolSignature(this._subscribedSymbols) === desiredSignature)
            return;

        if (this._pendingConnection?.symbolSignature === desiredSignature)
            return;

        this._reconnectTimeoutId = removeTimeout(this._reconnectTimeoutId);
        this._reconnectAttempt = 0;
        this._cancelPendingConnection();
        this._disconnectWebsocket();

        if (this._session)
            void this._connectIfNeeded();
    }

    isConnected() {
        return this._websocket !== null;
    }

    /* Provider identity and live-symbol validity together define both subscription and polling ownership. */
    ownsTicker(ticker) {
        return isLiveCryptoTicker(ticker, this.id);
    }

    /* REST polling is the normal-cadence fallback while the provider's websocket is unavailable. */
    shouldPoll() {
        return !this.isConnected();
    }

    /* Connected providers skip REST by default; subclasses can narrow fallback to rejected subscriptions. */
    selectPollTickers(tickers) {
        return this.shouldPoll() ? tickers : [];
    }

    /* Restored network availability restarts the existing reconnect ladder at its first delay. */
    reconnectNow() {
        if (!this._session)
            return;

        this._reconnectTimeoutId = removeTimeout(this._reconnectTimeoutId);
        this._reconnectAttempt = 0;
        this._recoverTransport();
    }

    _getDesiredSymbols() {
        return [...new Set(this._tickers.map(ticker => ticker.liveSymbol))];
    }

    _getSymbolToTickerSymbolMap() {
        return new Map(this._tickers.map(ticker => [ticker.liveSymbol, ticker.symbol.toUpperCase()]));
    }

    /*
     * Startup, reconnect, and resubscription all enter through this single-flight
     * handshake. Only the attempt that still owns the session and exact desired
     * symbol set may install its completed socket.
     */
    async _connectIfNeeded() {
        const liveSymbols = this._getDesiredSymbols();
        const cannotConnect =
            !this._session ||
            this._websocket ||
            this._pendingConnection ||
            liveSymbols.length === 0;
        if (cannotConnect)
            return;

        const attempt = {
            cancellable: new Gio.Cancellable(),
            generation: ++this._connectionGeneration,
            session: this._session,
            symbolSignature: createSymbolSignature(liveSymbols),
            symbols: liveSymbols,
        };
        this._pendingConnection = attempt;

        let websocket;
        try {
            websocket = await this._connectWebsocket(
                attempt.session,
                this._websocketUrl,
                attempt.cancellable
            );
        } catch (error) {
            if (!this._isCurrentConnectionAttempt(attempt))
                return;

            this._pendingConnection = null;
            this._recoverTransport({
                error,
                message: `failed to connect ${this._name} websocket`,
            });
            return;
        }

        if (!this._isCurrentConnectionAttempt(attempt) || this._websocket) {
            closeWebsocket(websocket);
            return;
        }

        this._pendingConnection = null;
        try {
            this._adoptWebsocket(websocket, attempt.symbols);
        } catch (error) {
            this._recoverTransport({
                error,
                message: `failed to initialize ${this._name} websocket`,
            });
        }
    }

    _isCurrentConnectionAttempt(attempt) {
        return (
            this._pendingConnection === attempt &&
            this._connectionGeneration === attempt.generation &&
            this._session === attempt.session &&
            createSymbolSignature(this._getDesiredSymbols()) === attempt.symbolSignature
        );
    }

    /* Invalidating first makes a connector that ignores cancellation harmless when it eventually completes. */
    _cancelPendingConnection() {
        this._connectionGeneration += 1;
        const pendingConnection = this._pendingConnection;
        this._pendingConnection = null;
        pendingConnection?.cancellable.cancel();
    }

    /* Socket callbacks capture their connection so delayed signals from an old transport cannot mutate new state. */
    _adoptWebsocket(websocket, liveSymbols) {
        this._websocket = websocket;
        this._websocketSignalIds = [];
        this._websocketSignalIds.push(
            websocket.connect('message', (_connection, type, messageBytes) => {
                if (this._websocket === websocket)
                    this._handleSocketMessage(type, messageBytes);
            })
        );
        this._websocketSignalIds.push(
            websocket.connect('error', (_connection, error) => {
                if (this._websocket === websocket) {
                    this._recoverTransport({
                        error,
                        message: `${this._name} websocket error`,
                    });
                }
            })
        );
        this._websocketSignalIds.push(
            websocket.connect('closed', () => {
                this._handleDisconnect(websocket);
            })
        );

        this._subscribedSymbols = liveSymbols;
        this._subscribe(websocket, liveSymbols);
        this._lastMessageUsec = GLib.get_monotonic_time();
        this._startWatchdog();
    }

    /* All socket cleanup funnels through one helper so stop(), reconnect, and resubscribe mirror each other. */
    _disconnectWebsocket() {
        this._watchdogTimeoutId = removeTimeout(this._watchdogTimeoutId);

        const websocket = this._websocket;
        const signalIds = this._websocketSignalIds;
        this._websocket = null;
        this._websocketSignalIds = [];
        this._subscribedSymbols = [];

        if (!websocket)
            return;

        signalIds.forEach(signalId => websocket.disconnect(signalId));
        closeWebsocket(websocket);
    }

    /* Closed callbacks participate only while their captured socket is still the active transport. */
    _handleDisconnect(websocket = this._websocket) {
        if (websocket && websocket !== this._websocket)
            return;

        this._recoverTransport();
    }

    /*
     * Every transport failure invalidates pending work, drops subscription
     * ownership, marks cached quotes stale, and schedules at most one retry.
     */
    _recoverTransport({error = null, message = null} = {}) {
        this._cancelPendingConnection();
        this._disconnectWebsocket();

        if (!this._session || this._getDesiredSymbols().length === 0)
            return;

        if (message)
            this._reportTransportFailure(error, message);
        this._notifyStaleTickers();
        this._scheduleReconnect();
    }

    /* Transport failures tell QuotesService that cached live quotes should render as stale. */
    _notifyStaleTickers(tickers = this._tickers) {
        if (tickers.length > 0)
            this._onStale(tickers);
    }

    /* A reconnect ladder may report one transport failure until real inbound traffic proves recovery. */
    _reportTransportFailure(error, message) {
        if (this._transportFailureReported)
            return;

        this._transportFailureReported = true;
        if (error)
            logError(error, `${this._uuid}: ${message}`);
        else
            log(`${this._uuid}: ${message}`);
    }

    /* All live providers share the same conservative reconnect policy so runtime behavior stays predictable. */
    _scheduleReconnect() {
        if (!this._session || this._reconnectTimeoutId !== 0 || this._getDesiredSymbols().length === 0)
            return;

        const index = Math.min(this._reconnectAttempt, LIVE_CRYPTO_RECONNECT_DELAYS_SECONDS.length - 1);
        const delaySeconds = LIVE_CRYPTO_RECONNECT_DELAYS_SECONDS[index];
        this._reconnectAttempt += 1;

        this._reconnectTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            delaySeconds,
            () => {
                this._reconnectTimeoutId = 0;
                void this._connectIfNeeded();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    /*
     * Half-open sockets can survive network changes without a close event.
     * Prolonged silence therefore follows the normal disconnect recovery path.
     */
    _startWatchdog() {
        this._watchdogTimeoutId = removeTimeout(this._watchdogTimeoutId);
        this._watchdogTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            LIVE_WATCHDOG_INTERVAL_SECONDS,
            () => {
                if (!this._session || !this._websocket) {
                    this._watchdogTimeoutId = 0;
                    return GLib.SOURCE_REMOVE;
                }

                if (!this._hasLiveTrafficTimedOut())
                    return GLib.SOURCE_CONTINUE;

                this._watchdogTimeoutId = 0;
                this._handleSilentConnection();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    /* Any inbound frame proves transport recovery, including provider heartbeats. */
    _markLiveTraffic() {
        this._lastMessageUsec = GLib.get_monotonic_time();
        this._transportFailureReported = false;
    }

    _hasLiveTrafficTimedOut(nowUsec = GLib.get_monotonic_time()) {
        return (nowUsec - this._lastMessageUsec) / 1_000_000 >= LIVE_SILENCE_TIMEOUT_SECONDS;
    }

    /* Silent sockets use the same stale notification and single-reconnect path as every other transport failure. */
    _handleSilentConnection() {
        this._recoverTransport({
            message: `${this._name} websocket silent for ${LIVE_SILENCE_TIMEOUT_SECONDS}s; reconnecting`,
        });
    }

    /* The base class handles decode and lifecycle actions; subclasses only decide what a payload means. */
    _handleSocketMessage(type, messageBytes) {
        this._markLiveTraffic();

        if (type !== Soup.WebsocketDataType.TEXT)
            return;

        let payload;

        try {
            payload = JSON.parse(new TextDecoder().decode(messageBytes.get_data()));
        } catch (error) {
            if (!this._payloadFailureReported) {
                this._payloadFailureReported = true;
                logError(error, `${this._uuid}: failed to parse ${this._name} websocket payload`);
            }
            return;
        }
        this._payloadFailureReported = false;

        const result = this._handlePayload(payload);

        if (result?.staleTickers?.length > 0)
            this._notifyStaleTickers(result.staleTickers);

        if (result?.reconnect) {
            this._recoverTransport();
            return;
        }

        if (result?.resetReconnect)
            this._reconnectAttempt = 0;

        if (result?.quotesBySymbol?.size > 0)
            this._onQuotes(result.quotesBySymbol);
    }

    /* Hook: send the provider-specific subscription messages. */
    _subscribe(_websocket, _symbols) {
        throw new Error('Subclasses must implement _subscribe()');
    }

    /* Hook: convert one decoded provider payload into stale, reconnect, and quote actions. */
    _handlePayload(_payload) {
        throw new Error('Subclasses must implement _handlePayload()');
    }
}

function createSymbolSignature(symbols) {
    return [...symbols].sort().join('|');
}

/* Late handshakes and active teardown share the same guarded socket close. */
function closeWebsocket(websocket) {
    const state = websocket.get_state();
    if (state !== Soup.WebsocketState.CLOSING && state !== Soup.WebsocketState.CLOSED)
        websocket.close(1000, null);
}

function removeTimeout(sourceId) {
    if (sourceId === 0) return 0;

    GLib.Source.remove(sourceId);
    return 0;
}
