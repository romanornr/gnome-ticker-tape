import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {isLiveCryptoTicker} from '../utils/asset-categories.js';

const LIVE_CRYPTO_RECONNECT_DELAYS_SECONDS = [2, 5, 10, 20, 30, 60];
const LIVE_SILENCE_TIMEOUT_SECONDS = 60;
const LIVE_WATCHDOG_INTERVAL_SECONDS = 15;

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

export class LiveWebsocketProvider {
    constructor({
        id,
        name,
        websocketUrl,
        uuid,
        onQuotes,
        onStale,
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
        this._reconnectTimeoutId = 0;
        this._reconnectAttempt = 0;
        this._watchdogTimeoutId = 0;
        this._readySymbols = new Set();
        this._transportFailureReported = false;
        this._payloadFailureReported = false;
    }

    start(session) {
        this._session = session;
    }

    stop() {
        this._session = null;
        this._reconnectTimeoutId = removeTimeout(this._reconnectTimeoutId);
        this._cancelPendingConnection();
        this._disconnectWebsocket();
        this._tickers = [];
    }

    updateSubscriptions(tickers) {
        const previousSignature = createSymbolSignature(this._getDesiredSymbols());
        this._tickers = tickers.filter(ticker => this.ownsTicker(ticker));

        const desiredSymbols = this._getDesiredSymbols();
        const subscriptionsUnchanged =
            createSymbolSignature(desiredSymbols) === previousSignature;
        if (desiredSymbols.length > 0 && subscriptionsUnchanged && (this._websocket || this._pendingConnection))
            return;

        this._reconnectTimeoutId = removeTimeout(this._reconnectTimeoutId);
        this._reconnectAttempt = 0;
        this._cancelPendingConnection();
        this._disconnectWebsocket();

        if (desiredSymbols.length > 0)
            void this._connectIfNeeded();
    }

    ownsTicker(ticker) {
        return isLiveCryptoTicker(ticker, this.id);
    }

    /* REST fallback remains active until a valid live quote arrives for the symbol. */
    selectPollTickers(tickers) {
        return tickers.filter(ticker => !this._readySymbols.has(ticker.liveSymbol));
    }

    reconnectNow() {
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

    /* Only the cancellable that still owns the pending handshake may install its socket. */
    async _connectIfNeeded() {
        const liveSymbols = this._getDesiredSymbols();
        if (!this._session || this._websocket || this._pendingConnection || liveSymbols.length === 0)
            return;

        const session = this._session;
        const pendingConnection = new Gio.Cancellable();
        this._pendingConnection = pendingConnection;

        let websocket;
        try {
            websocket = await this._connectWebsocket(session, this._websocketUrl, pendingConnection);
        } catch (error) {
            if (this._pendingConnection !== pendingConnection)
                return;

            this._pendingConnection = null;
            this._recoverTransport({error, message: `failed to connect ${this._name} websocket`});
            return;
        }

        if (this._pendingConnection !== pendingConnection) {
            closeWebsocket(websocket);
            return;
        }

        this._pendingConnection = null;
        this._adoptWebsocket(websocket, liveSymbols);
    }

    /* Invalidating first makes a connector that ignores cancellation harmless when it eventually completes. */
    _cancelPendingConnection() {
        const pendingConnection = this._pendingConnection;
        this._pendingConnection = null;
        if (pendingConnection)
            pendingConnection.cancel();
    }

    _adoptWebsocket(websocket, liveSymbols) {
        this._websocket = websocket;
        this._websocketSignalIds = [
            websocket.connect('message', (_connection, type, messageBytes) =>
                this._handleSocketMessage(type, messageBytes)),
            websocket.connect('error', (_connection, error) =>
                this._recoverTransport({error, message: `${this._name} websocket error`})),
            websocket.connect('closed', () => this._recoverTransport()),
        ];

        this._lastMessageUsec = GLib.get_monotonic_time();
        this._subscribe(websocket, liveSymbols);
        this._startWatchdog();
    }

    _disconnectWebsocket() {
        this._watchdogTimeoutId = removeTimeout(this._watchdogTimeoutId);

        const websocket = this._websocket;
        const signalIds = this._websocketSignalIds;
        this._websocket = null;
        this._websocketSignalIds = [];
        this._readySymbols.clear();

        if (!websocket)
            return;

        signalIds.forEach(signalId => websocket.disconnect(signalId));
        closeWebsocket(websocket);
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
        if (this._tickers.length > 0)
            this._onStale(this._tickers);
        this._scheduleReconnect();
    }

    _reportTransportFailure(error, message) {
        if (this._transportFailureReported)
            return;

        this._transportFailureReported = true;
        if (error)
            logError(error, `${this._uuid}: ${message}`);
        else
            log(`${this._uuid}: ${message}`);
    }

    _scheduleReconnect() {
        if (this._reconnectTimeoutId !== 0)
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
                if (!this._hasLiveTrafficTimedOut())
                    return GLib.SOURCE_CONTINUE;

                this._watchdogTimeoutId = 0;
                this._recoverTransport({
                    message: `${this._name} websocket silent for ${LIVE_SILENCE_TIMEOUT_SECONDS}s; reconnecting`,
                });
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _hasLiveTrafficTimedOut(nowUsec = GLib.get_monotonic_time()) {
        return (nowUsec - this._lastMessageUsec) / 1_000_000 >= LIVE_SILENCE_TIMEOUT_SECONDS;
    }

    _handleSocketMessage(type, messageBytes) {
        this._lastMessageUsec = GLib.get_monotonic_time();

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
        if (!result)
            return;

        if (result.staleTickers?.length > 0) {
            result.staleTickers.forEach(ticker => this._readySymbols.delete(ticker.liveSymbol));
            this._onStale(result.staleTickers);
        }

        if (result.quotesBySymbol?.size > 0) {
            result.readySymbols.forEach(symbol => this._readySymbols.add(symbol));
            this._reconnectAttempt = 0;
            this._transportFailureReported = false;
            this._onQuotes(result.quotesBySymbol);
        }
    }
}

function createSymbolSignature(symbols) {
    return [...symbols].sort().join('|');
}

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
