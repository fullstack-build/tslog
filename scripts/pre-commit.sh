#!/usr/bin/env bash
set -euo pipefail

# Ensure npm is available, falling back to nvm for non-login shells.
if ! command -v npm >/dev/null 2>&1; then
    export NVM_DIR="${NVM_DIR:-"$HOME/.nvm"}"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
        # shellcheck disable=SC1090
        . "$NVM_DIR/nvm.sh"
        nvm use --silent >/dev/null 2>&1 || nvm use >/dev/null 2>&1
    fi
fi

if ! command -v npm >/dev/null 2>&1; then
    echo "pre-commit: npm command not found. Install Node.js or ensure it is in PATH." >&2
    exit 127
fi

npm run test
npm run format
npm run lint
npm run build
npm run docsify-init
