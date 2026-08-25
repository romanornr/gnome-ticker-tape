/*
 * Catalog symbols keep their historical Stooq-style form ("aapl.us", "abn.nl",
 * "700.hk") because saved user settings already contain them. This module owns
 * the translation of that canonical form into CNBC's symbol grammar.
 */

/* Futures use CNBC's front-month "@XX.1" grammar with legacy pit codes, indices use ".XXX"; each entry live-verified. */
const CNBC_SYMBOL_OVERRIDES = new Map(Object.entries({
    'cc.f': '@CC.1',
    'cl.f': '@CL.1',
    'ct.f': '@CT.1',
    'gc.f': '@GC.1',
    'gf.f': '@FC.1',
    'he.f': '@LH.1',
    'hg.f': '@HG.1',
    'ho.f': '@HO.1',
    'kc.f': '@KC.1',
    'ke.f': '@KW.1',
    'lb.f': '@LBR.1',
    'le.f': '@LC.1',
    'ng.f': '@NG.1',
    'ni.f': '@NI.1',
    'oj.f': '@OJ.1',
    'pa.f': '@PA.1',
    'pl.f': '@PL.1',
    'rb.f': '@RB.1',
    'sb.f': '@SB.1',
    'si.f': '@SI.1',
    'zc.f': '@C.1',
    'zl.f': '@BO.1',
    'zm.f': '@SM.1',
    'zn.f': '@LZN.1',
    'zs.f': '@S.1',
    'zw.f': '@W.1',
    'xagusd': 'XAG=',
    'xauusd': 'XAU=',
    '^spx': '.SPX',
    '^ndq': '.NDX',
    '^dji': '.DJI',
}));

/* The FX catalog generates every pair from these codes, so pair symbols are recognized against the same list. */
const FX_CURRENCY_CODES = new Set([
    'AUD', 'BRL', 'CAD', 'CHF', 'CZK', 'DKK', 'EUR', 'GBP', 'HUF', 'INR', 'JPY',
    'MXN', 'NOK', 'NZD', 'PLN', 'RUB', 'SEK', 'SGD', 'TRY', 'USD', 'ZAR',
]);

/*
 * CNBC's per-currency spot symbols follow FX market convention on direction.
 * These four quote as USD per currency unit ("EUR=" is 1.15 USD per euro).
 * Every other code quotes as currency units per USD ("JPY=" is 155 yen per dollar).
 */
const USD_QUOTED_CURRENCIES = new Set(['EUR', 'GBP', 'AUD', 'NZD']);

/*
 * Suffix rules per market, each validated against the full curated catalog:
 * .us bare ticker, .nl/-NL, .de/-DE, .uk/-GB, .jp/.T, .hk zero-padded .HK,
 * .cn Shanghai/Shenzhen split on the leading digit.
 */
export function mapSymbolToCnbc(symbol) {
    const normalized = `${symbol ?? ''}`.trim().toLowerCase();
    if (normalized === '')
        return null;

    const override = CNBC_SYMBOL_OVERRIDES.get(normalized);
    if (override)
        return override;

    const separatorIndex = normalized.lastIndexOf('.');
    if (separatorIndex <= 0)
        return null;

    const base = normalized.slice(0, separatorIndex);
    const market = normalized.slice(separatorIndex + 1);

    switch (market) {
    case 'us':
        /* US class shares use dot notation on CNBC (brk-b -> BRK.B). */
        return base.toUpperCase().replace(/-/g, '.');
    case 'nl':
        return `${base.toUpperCase()}-NL`;
    case 'de':
        return `${base.toUpperCase()}-DE`;
    case 'uk':
        /* LSE tickers shorter than three characters carry a trailing dot (BA., BP., NG.). */
        return base.length <= 2 ? `${base.toUpperCase()}.-GB` : `${base.toUpperCase()}-GB`;
    case 'jp':
        return `${base.toUpperCase()}.T`;
    case 'hk':
        return `${base.padStart(4, '0')}.HK`;
    case 'cn':
        return `${base}${base.startsWith('6') ? '.SS' : '.SZ'}`;
    default:
        return null;
    }
}

/* FX pairs have no direct CNBC symbol; they are derived from per-currency spot rates instead. */
export function parseFxPairSymbol(symbol) {
    const normalized = `${symbol ?? ''}`.trim().toUpperCase();
    if (!/^[A-Z]{6}$/.test(normalized))
        return null;

    const baseCurrency = normalized.slice(0, 3);
    const quoteCurrency = normalized.slice(3);
    if (!FX_CURRENCY_CODES.has(baseCurrency) || !FX_CURRENCY_CODES.has(quoteCurrency) || baseCurrency === quoteCurrency)
        return null;

    return {baseCurrency, quoteCurrency};
}

/* Non-USD currencies resolve through CNBC's spot symbol; USD is the vector anchor and needs no request. */
export function buildFxSpotSymbol(currencyCode) {
    return currencyCode === 'USD' ? null : `${currencyCode}=`;
}

/* Every FX rate is normalized into USD-per-unit so any pair reduces to one division. */
export function toUsdPerUnit(currencyCode, spotRate) {
    if (currencyCode === 'USD')
        return 1;

    if (!Number.isFinite(spotRate) || spotRate <= 0)
        return null;

    return USD_QUOTED_CURRENCIES.has(currencyCode) ? spotRate : 1 / spotRate;
}
