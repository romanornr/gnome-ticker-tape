import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const UUID = 'ticker-tape@romanornr';
const LEFT_AREA = `${UUID}-left`;
const RIGHT_AREA = `${UUID}-right`;
const WAIT_ATTEMPTS = 100;
const WAIT_INTERVAL_MS = 50;

export var METRICS = {};

/* The smoke test waits on public lifecycle state rather than fixed startup delays. */
async function waitForExtensionState(expectedState) {
    for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt++) {
        const extension = Main.extensionManager.lookup(UUID);

        if (extension?.state === ExtensionState.ERROR)
            throw new Error(`Extension entered the error state: ${extension.error ?? 'unknown error'}`);

        if (extension?.state === expectedState)
            return;

        await Scripting.sleep(WAIT_INTERVAL_MS);
    }

    throw new Error(`Timed out waiting for extension state ${expectedState}`);
}

/* Default settings place tickers on both panel sides, making both actors part of the package contract. */
function assertIndicatorLifecycle(expectedPresent) {
    const leftPresent = Main.panel.statusArea[LEFT_AREA] !== undefined;
    const rightPresent = Main.panel.statusArea[RIGHT_AREA] !== undefined;

    if (leftPresent !== expectedPresent || rightPresent !== expectedPresent)
        throw new Error(`Unexpected indicator state: left=${leftPresent}, right=${rightPresent}`);
}

/* Exercise the installed ZIP through one complete enable/disable/enable lifecycle. */
export async function run() {
    await waitForExtensionState(ExtensionState.ACTIVE);
    assertIndicatorLifecycle(true);

    if (!Main.extensionManager.disableExtension(UUID))
        throw new Error('GNOME Shell refused to disable the extension');

    await waitForExtensionState(ExtensionState.INACTIVE);
    assertIndicatorLifecycle(false);

    if (!Main.extensionManager.enableExtension(UUID))
        throw new Error('GNOME Shell refused to enable the extension');

    await waitForExtensionState(ExtensionState.ACTIVE);
    assertIndicatorLifecycle(true);
}
