import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {ASSET_CATEGORIES, CRYPTO_PROVIDERS, withDefaultMarketSession} from '../../asset-categories.js';
import {
    normalizeKrakenLiveSymbol,
    normalizeKrakenTickerSymbol,
} from './symbols.js';

export const KRAKEN_WEBSOCKET_URL = 'wss://ws.kraken.com/v2';

const KRAKEN_INSTRUMENT_TIMEOUT_SECONDS = 15;
const KRAKEN_INSTRUMENT_MAX_INCOMING_PAYLOAD_SIZE = 32 * 1024 * 1024;
const KRAKEN_SPOT_PAIR_QUOTE_PRIORITY = ['USD', 'EUR', 'USDT', 'USDC', 'BTC', 'ETH'];

let cachedKrakenSpotPairsPromise = null;

/* prefs loads the cached Kraken spot catalog through this public entrypoint. */
export async function loadKrakenSpotPairs() {
    if (!cachedKrakenSpotPairsPromise) {
        cachedKrakenSpotPairsPromise = _fetchKrakenSpotPairs().catch(error => {
            cachedKrakenSpotPairsPromise = null;
            throw error;
        });
    }

    return cloneKrakenSpotPairs(await cachedKrakenSpotPairsPromise);
}

/* Kraken instrument metadata becomes the shared catalog shape with its centralized session default here. */
export function createKrakenCatalogEntry(pair) {
    const liveSymbol = normalizeKrakenLiveSymbol(pair?.symbol ?? '');
    const base = `${pair?.base ?? ''}`.trim().toUpperCase();
    const quote = `${pair?.quote ?? ''}`.trim().toUpperCase();
    const normalizedSymbol = normalizeKrakenTickerSymbol(liveSymbol);

    return withDefaultMarketSession({
        assetCategory: ASSET_CATEGORIES.CRYPTO,
        cryptoProvider: CRYPTO_PROVIDERS.KRAKEN,
        label: liveSymbol || `${base}/${quote}`,
        symbol: normalizedSymbol,
        priceDecimals: clampDecimals(pair?.price_precision),
        liveSymbol,
        keywords: [base, quote, normalizedSymbol],
        base,
        quote,
    });
}

/* Cached Kraken pair lists are cloned to keep callers from mutating shared provider state. */
function cloneKrakenSpotPairs(pairs) {
    return pairs.map(entry => ({
        ...entry,
        keywords: [...entry.keywords ?? []],
    }));
}

/* Kraken spot pairs are discovered by subscribing to the instrument snapshot websocket channel once. */
async function _fetchKrakenSpotPairs() {
    const session = new Soup.Session();
    let websocket = null;
    let timeoutId = 0;
    let messageSignalId = 0;
    let closedSignalId = 0;
    let errorSignalId = 0;

    try {
        const message = Soup.Message.new('GET', KRAKEN_WEBSOCKET_URL);
        websocket = await new Promise((resolve, reject) => {
            session.websocket_connect_async(message, null, [], GLib.PRIORITY_DEFAULT, null, (_session, result) => {
                try {
                    resolve(session.websocket_connect_finish(result));
                } catch (error) {
                    reject(error);
                }
            });
        });
        websocket.set_max_incoming_payload_size(KRAKEN_INSTRUMENT_MAX_INCOMING_PAYLOAD_SIZE);

        const pairs = await new Promise((resolve, reject) => {
            const rejectOnce = error => {
                if (timeoutId !== 0) {
                    GLib.Source.remove(timeoutId);
                    timeoutId = 0;
                }

                reject(error);
            };

            timeoutId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                KRAKEN_INSTRUMENT_TIMEOUT_SECONDS,
                () => {
                    timeoutId = 0;
                    reject(new Error('Timed out while loading Kraken instrument data.'));
                    return GLib.SOURCE_REMOVE;
                }
            );

            messageSignalId = websocket.connect('message', (_connection, type, messageBytes) => {
                if (type !== Soup.WebsocketDataType.TEXT)
                    return;

                try {
                    const payload = JSON.parse(new TextDecoder().decode(messageBytes.get_data()));

                    if (payload?.success === false)
                        throw new Error(payload.error ?? 'Kraken instrument subscription failed.');

                    if (payload?.channel === 'instrument' && payload?.type === 'snapshot') {
                        if (timeoutId !== 0) {
                            GLib.Source.remove(timeoutId);
                            timeoutId = 0;
                        }

                        resolve(payload?.data?.pairs ?? []);
                    }
                } catch (error) {
                    rejectOnce(error);
                }
            });

            closedSignalId = websocket.connect('closed', () => {
                rejectOnce(new Error('Kraken instrument socket closed before a snapshot arrived.'));
            });

            errorSignalId = websocket.connect('error', (_connection, error) => {
                rejectOnce(error);
            });

            websocket.send_text(JSON.stringify({
                method: 'subscribe',
                params: {
                    channel: 'instrument',
                    snapshot: true,
                },
            }));
        });

        return pairs
            .filter(pair => pair?.status === 'online')
            .map(createKrakenCatalogEntry)
            .filter(entry => entry.liveSymbol !== '' && entry.symbol !== '' && entry.base !== '' && entry.quote !== '')
            .sort(compareKrakenCatalogEntries);
    } finally {
        if (timeoutId !== 0)
            GLib.Source.remove(timeoutId);

        if (websocket) {
            if (messageSignalId !== 0)
                websocket.disconnect(messageSignalId);

            if (closedSignalId !== 0)
                websocket.disconnect(closedSignalId);

            if (errorSignalId !== 0)
                websocket.disconnect(errorSignalId);

            const state = websocket.get_state();
            if (state !== Soup.WebsocketState.CLOSING && state !== Soup.WebsocketState.CLOSED)
                websocket.close(1000, null);
        }

        session.abort();
    }
}

/* Price precision is normalized into the extension's bounded decimals range here. */
function clampDecimals(value) {
    const parsed = Number.parseInt(`${value ?? ''}`, 10);
    if (!Number.isInteger(parsed)) return 2;

    return Math.min(6, Math.max(0, parsed));
}

/* Sorting keeps similar bases grouped while preferring similar quote currencies first. */
function compareKrakenCatalogEntries(left, right) {
    const priorityDifference = getKrakenQuotePriority(left.quote) - getKrakenQuotePriority(right.quote);
    if (left.base === right.base && priorityDifference !== 0) return priorityDifference;

    return left.label.localeCompare(right.label);
}

function getKrakenQuotePriority(quote) {
    const index = KRAKEN_SPOT_PAIR_QUOTE_PRIORITY.indexOf(`${quote ?? ''}`.trim().toUpperCase());
    return index === -1 ? KRAKEN_SPOT_PAIR_QUOTE_PRIORITY.length : index;
}
