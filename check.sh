#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR=""

cleanup() {
    if [[ -n "${PACKAGE_DIR}" && -d "${PACKAGE_DIR}" ]]; then
        rm -rf "${PACKAGE_DIR}"
    fi
}

trap cleanup EXIT
cd "${ROOT_DIR}"

if command -v gnome-shell >/dev/null 2>&1; then
    GNOME_SHELL_MAJOR="$(gnome-shell --version | sed -nE 's/^GNOME Shell ([0-9]+).*/\1/p')"

    if [[ -n "${GNOME_SHELL_MAJOR}" ]] && ! grep -Eq "\"${GNOME_SHELL_MAJOR}\"" metadata.json; then
        printf 'metadata.json does not list installed GNOME Shell major version: %s\n' "${GNOME_SHELL_MAJOR}" >&2
        exit 1
    fi
fi

if [[ ! -x node_modules/.bin/eslint ]]; then
    printf 'Lint dependencies are missing. Run npm ci first.\n' >&2
    exit 1
fi

printf 'Running ESLint...\n'
npm run --silent lint

printf '\nRunning focused GJS test suites...\n'
gjs -m tests/run.js

printf '\nBuilding and checking the extension package...\n'
PACKAGE_DIR="$(mktemp -d)"
./pack.sh "${PACKAGE_DIR}"

ARCHIVE="${PACKAGE_DIR}/ticker-tape@romanornr.shell-extension.zip"
EXPECTED_FILES="${PACKAGE_DIR}/expected-files.txt"
ACTUAL_FILES="${PACKAGE_DIR}/actual-files.txt"

unzip -tq "${ARCHIVE}"

{
    printf '%s\n' LICENSE extension.js metadata.json prefs.js
    find services ui utils -type f -name '*.js' -print
    find schemas -type f -name '*.xml' -print
} | LC_ALL=C sort > "${EXPECTED_FILES}"

unzip -Z1 "${ARCHIVE}" \
    | sed '/\/$/d' \
    | LC_ALL=C sort > "${ACTUAL_FILES}"

if ! diff -u "${EXPECTED_FILES}" "${ACTUAL_FILES}"; then
    printf 'The packaged production-file inventory does not match the repository.\n' >&2
    exit 1
fi

printf '\nAll local checks passed.\n'
