import {runTests as runLiveProviderTests} from './live-provider.test.js';
import {runTests as runMarketScheduleTests} from './market-schedule.behavior.test.js';
import {runTests as runPresentationTests} from './presentation.test.js';
import {runTests as runQuotesRuntimeTests} from './quotes-runtime.test.js';
import {runTests as runProviderQuoteTests} from './provider-quotes.test.js';
import {runTests as runTickerSettingsTests} from './ticker-settings.test.js';

const suites = [
    ['market-schedule', runMarketScheduleTests],
    ['ticker-settings', runTickerSettingsTests],
    ['provider-quotes', runProviderQuoteTests],
    ['live-provider', runLiveProviderTests],
    ['quotes-runtime', runQuotesRuntimeTests],
    ['presentation', runPresentationTests],
];

let failureCount = 0;

for (const [name, runTests] of suites) {
    try {
        await runTests();
        print(`PASS ${name}`);
    } catch (error) {
        failureCount += 1;
        printerr(`FAIL ${name}: ${error.message}`);
    }
}

if (failureCount > 0)
    throw new Error(`${failureCount} test suite(s) failed.`);

print(`PASS all ${suites.length} suites`);
