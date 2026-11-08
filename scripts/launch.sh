#!/bin/sh
# Lanceur des raccourcis macOS et Linux (app du Dock, icône du bureau) : une app lancée depuis le bureau ne connaît
# pas le PATH du terminal, on y ajoute donc les emplacements habituels de Node, puis scripts/launch.mjs prend la main.
ROOT=$(cd "$(dirname "$0")/.." && pwd)
export PATH="$HOME/.local/node/bin:$HOME/.volta/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi
exec node "$ROOT/scripts/launch.mjs" "$@"
