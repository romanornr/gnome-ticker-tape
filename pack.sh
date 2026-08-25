#!/usr/bin/env bash

set -euo pipefail

if [[ "$#" -gt 1 ]]; then
    printf 'Usage: %s [OUTPUT_DIR]\n' "${0##*/}" >&2
    exit 2
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$#" -eq 0 ]]; then
    OUTPUT_DIR="${ROOT_DIR}/dist"
elif [[ "$1" == /* ]]; then
    OUTPUT_DIR="$1"
else
    OUTPUT_DIR="${PWD}/$1"
fi

mkdir -p "${OUTPUT_DIR}"
cd "${ROOT_DIR}"

gnome-extensions pack \
    --force \
    --out-dir="${OUTPUT_DIR}" \
    --extra-source=LICENSE \
    --extra-source=providers \
    --extra-source=ui \
    --extra-source=services \
    --extra-source=utils \
    .

printf 'Created %s/ticker-tape@romanornr.shell-extension.zip\n' "${OUTPUT_DIR}"
