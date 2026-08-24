#!/usr/bin/env bash

set -euo pipefail

UUID="ticker-tape@romanornr"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSIONS_DIR="${HOME}/.local/share/gnome-shell/extensions"
TARGET_DIR="${EXTENSIONS_DIR}/${UUID}"

mkdir -p "${EXTENSIONS_DIR}"

if [[ -e "${TARGET_DIR}" && ! -L "${TARGET_DIR}" ]]; then
    printf 'Removing existing install at %s\n' "${TARGET_DIR}"
    rm -rf "${TARGET_DIR}"
elif [[ -L "${TARGET_DIR}" ]]; then
    rm -f "${TARGET_DIR}"
fi

glib-compile-schemas "${SOURCE_DIR}/schemas"
ln -s "${SOURCE_DIR}" "${TARGET_DIR}"
printf 'Linked %s -> %s\n' "${TARGET_DIR}" "${SOURCE_DIR}"

if gnome-extensions info "${UUID}" >/dev/null 2>&1 && gnome-extensions enable "${UUID}"; then
    printf 'Enabled extension: %s\n' "${UUID}"
else
    printf 'GNOME Shell has not picked up %s yet.\n' "${UUID}"

    GNOME_SHELL_MAJOR=""
    if command -v gnome-shell >/dev/null 2>&1; then
        GNOME_SHELL_MAJOR="$(gnome-shell --version | sed -nE 's/^GNOME Shell ([0-9]+).*/\1/p')"
    fi

    if [[ "${XDG_SESSION_TYPE:-}" == "x11" && "${GNOME_SHELL_MAJOR}" =~ ^[0-9]+$ && "${GNOME_SHELL_MAJOR}" -lt 50 ]]; then
        printf 'On GNOME %s with Xorg, press Alt+F2, type r, and press Enter.\n' "${GNOME_SHELL_MAJOR}"
        printf 'Then run: gnome-extensions enable %s\n' "${UUID}"
    else
        printf 'Log out and back in, then run: gnome-extensions enable %s\n' "${UUID}"
    fi
fi
