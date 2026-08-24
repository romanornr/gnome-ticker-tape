#!/usr/bin/env bash

set -euo pipefail

UUID="ticker-tape@romanornr"

# GNOME Shell 49's test tool has no --extension option. The tool invokes this
# mode inside its temporary XDG environment immediately before starting Shell.
if [[ "${1:-}" == "--shell49-wrapper" ]]; then
    shift
    : "${TICKER_TAPE_TEST_ARCHIVE:?Missing packaged extension path}"
    : "${XDG_DATA_HOME:?Missing isolated data directory}"

    gnome-extensions install "${TICKER_TAPE_TEST_ARCHIVE}"
    INSTALLED_METADATA="${XDG_DATA_HOME}/gnome-shell/extensions/${UUID}/metadata.json"
    if [[ ! -f "${INSTALLED_METADATA}" ]]; then
        printf 'Extension package was not installed at %s\n' "${INSTALLED_METADATA}" >&2
        exit 1
    fi

    gsettings set org.gnome.shell enabled-extensions "['${UUID}']"
    exec "$@"
fi

if [[ "$#" -ne 0 ]]; then
    printf 'Usage: %s\n' "${0##*/}" >&2
    exit 2
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SMOKE_DIR=""

cleanup() {
    if [[ -n "${SMOKE_DIR}" && -d "${SMOKE_DIR}" ]]; then
        rm -rf "${SMOKE_DIR}"
    fi
}

trap cleanup EXIT

for command_name in dbus-run-session gnome-extensions gnome-shell gnome-shell-test-tool; do
    if ! command -v "${command_name}" >/dev/null 2>&1; then
        printf 'Required command is missing: %s\n' "${command_name}" >&2
        exit 1
    fi
done

GNOME_SHELL_MAJOR="$(gnome-shell --version | sed -nE 's/^GNOME Shell ([0-9]+).*/\1/p')"
if [[ "${GNOME_SHELL_MAJOR}" != "49" && "${GNOME_SHELL_MAJOR}" != "50" ]]; then
    printf 'The packaged smoke test supports GNOME Shell 49 and 50; found %s.\n' "${GNOME_SHELL_MAJOR:-unknown}" >&2
    exit 1
fi

SMOKE_DIR="$(mktemp -d)"
"${ROOT_DIR}/pack.sh" "${SMOKE_DIR}"
ARCHIVE="${SMOKE_DIR}/${UUID}.shell-extension.zip"
SCRIPT="${ROOT_DIR}/tests/shell-smoke.js"
SMOKE_LOG="${SMOKE_DIR}/gnome-shell-test.log"

printf 'Running packaged lifecycle smoke test on GNOME Shell %s...\n' "${GNOME_SHELL_MAJOR}"

if [[ "${GNOME_SHELL_MAJOR}" == "50" ]]; then
    if ! dbus-run-session -- \
        gnome-shell-test-tool \
        --headless \
        --disable-animations \
        --extension "${ARCHIVE}" \
        "${SCRIPT}" > "${SMOKE_LOG}" 2>&1; then
        cat "${SMOKE_LOG}" >&2
        exit 1
    fi
else
    WRAPPER="${SMOKE_DIR}/shell49-wrapper"
    XDG_CACHE_DIR="${SMOKE_DIR}/xdg-cache"
    XDG_CONFIG_DIR="${SMOKE_DIR}/xdg-config"
    XDG_DATA_DIR="${SMOKE_DIR}/xdg-data"
    cp "${ROOT_DIR}/check-shell.sh" "${WRAPPER}"
    chmod +x "${WRAPPER}"
    mkdir -p "${XDG_CACHE_DIR}" "${XDG_CONFIG_DIR}" "${XDG_DATA_DIR}"

    if ! GSETTINGS_BACKEND=keyfile \
        TICKER_TAPE_TEST_ARCHIVE="${ARCHIVE}" \
        XDG_CACHE_HOME="${XDG_CACHE_DIR}" \
        XDG_CONFIG_HOME="${XDG_CONFIG_DIR}" \
        XDG_DATA_HOME="${XDG_DATA_DIR}" \
        dbus-run-session -- \
        gnome-shell-test-tool \
        --headless \
        --wrap "${WRAPPER} --shell49-wrapper" \
        "${SCRIPT}" > "${SMOKE_LOG}" 2>&1; then
        cat "${SMOKE_LOG}" >&2
        exit 1
    fi
fi

printf 'Packaged lifecycle smoke test passed.\n'
