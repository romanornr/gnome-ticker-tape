import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {ASSET_CATEGORIES, CRYPTO_PROVIDERS} from '../../utils/asset-categories.js';
import {normalizeKrakenLiveSymbol, normalizeKrakenTickerSymbol} from './symbols.js';
import {closeWebsocket, openWebsocket} from '../websocket.js';

export const KRAKEN_WEBSOCKET_URL = 'wss://ws.kraken.com/v2';

const KRAKEN_INSTRUMENT_TIMEOUT_SECONDS = 15;
const KRAKEN_INSTRUMENT_MAX_INCOMING_PAYLOAD_SIZE = 32 * 1024 * 1024;
const KRAKEN_QUOTE_PRIORITY = ['USD', 'EUR', 'USDT', 'USDC', 'BTC', 'ETH'];

let cachedKrakenSpotPairsPromise = null;

export function loadKrakenSpotPairs() {
    cachedKrakenSpotPairsPromise ??= _fetchKrakenSpotPairs().catch(error => {
        cachedKrakenSpotPairsPromise = null;
        throw error;
    });

    return cachedKrakenSpotPairsPromise;
}

/* Kraken instrument metadata becomes the catalog shape shared by prefs and runtime polling. */
function createKrakenCatalogEntry(pair) {
    const liveSymbol = normalizeKrakenLiveSymbol(pair?.symbol ?? '');
    const base = `${pair?.base ?? ''}`.trim().toUpperCase();
    const quote = `${pair?.quote ?? ''}`.trim().toUpperCase();
    const normalizedSymbol = normalizeKrakenTickerSymbol(liveSymbol);

    return {
        assetCategory: ASSET_CATEGORIES.CRYPTO,
        cryptoProvider: CRYPTO_PROVIDERS.KRAKEN,
        label: liveSymbol || `${base}/${quote}`,
        symbol: normalizedSymbol,
        priceDecimals: clampDecimals(pair?.price_precision),
        liveSymbol,
        keywords: [base, quote, normalizedSymbol],
        base,
        quote,
    };
}

/* Kraken spot pairs are discovered by subscribing to the instrument snapshot websocket channel once. */
async function _fetchKrakenSpotPairs() {
    const session = new Soup.Session();

    try {
        const websocket = await openWebsocket(session, KRAKEN_WEBSOCKET_URL);
        websocket.set_max_incoming_payload_size(KRAKEN_INSTRUMENT_MAX_INCOMING_PAYLOAD_SIZE);

        try {
            return (await readInstrumentPairs(websocket))
                .filter(pair => pair?.status === 'online')
                .map(createKrakenCatalogEntry)
                .filter(entry => entry.liveSymbol !== '' && entry.symbol !== '' && entry.base !== '' && entry.quote !== '')
                .sort(compareKrakenCatalogEntries);
        } finally {
            closeWebsocket(websocket);
        }
    } finally {
        session.abort();
    }
}

async function readInstrumentPairs(websocket) {
    const {promise, resolve, reject} = Promise.withResolvers();
    const signalIds = [
        websocket.connect('message', (_connection, type, messageBytes) => {
            if (type !== Soup.WebsocketDataType.TEXT)
                return;

            try {
                const payload = JSON.parse(new TextDecoder().decode(messageBytes.get_data()));
                if (payload?.success === false) {
                    reject(new Error(payload.error ?? 'Kraken instrument subscription failed.'));
                } else if (payload?.channel === 'instrument' && payload?.type === 'snapshot') {
                    if (!Array.isArray(payload?.data?.pairs))
                        reject(new Error('Kraken returned an invalid instrument snapshot.'));
                    else
                        resolve(payload.data.pairs);
                }
            } catch (error) {
                reject(error);
            }
        }),
        websocket.connect('closed', () =>
            reject(new Error('Kraken instrument socket closed before a snapshot arrived.'))),
        websocket.connect('error', (_connection, error) => reject(error)),
    ];
    let timeoutId = GLib.timeout_add_seconds(
        GLib.PRIORITY_DEFAULT,
        KRAKEN_INSTRUMENT_TIMEOUT_SECONDS,
        () => {
            timeoutId = 0;
            reject(new Error('Timed out while loading Kraken instrument data.'));
            return GLib.SOURCE_REMOVE;
        }
    );

    websocket.send_text(JSON.stringify({
        method: 'subscribe',
        params: {channel: 'instrument', snapshot: true},
    }));

    try {
        return await promise;
    } finally {
        if (timeoutId !== 0)
            GLib.Source.remove(timeoutId);
        signalIds.forEach(signalId => websocket.disconnect(signalId));
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
    const priorityDifference = quotePriority(left.quote) - quotePriority(right.quote);
    if (left.base === right.base && priorityDifference !== 0) return priorityDifference;

    return left.label.localeCompare(right.label);
}

function quotePriority(quote) {
    const index = KRAKEN_QUOTE_PRIORITY.indexOf(quote);
    return index === -1 ? KRAKEN_QUOTE_PRIORITY.length : index;
}
