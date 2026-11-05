#!/bin/zsh
# Démarre le serveur Discothèque s'il ne tourne pas, puis ouvre l'interface.
# Avec Chrome, Brave ou Edge : fenêtre d'application dédiée (sans onglets ni barre d'adresse).
ROOT="${0:A:h:h}"
PORT="${PORT:-4321}"
URL="http://localhost:$PORT"
export PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! curl -s -o /dev/null "$URL/api/status"; then
  mkdir -p "$ROOT/cache"
  cd "$ROOT" && nohup node server.js > "$ROOT/cache/server.log" 2>&1 &
  for i in {1..60}; do curl -s -o /dev/null "$URL/api/status" && break; sleep 0.25; done
fi

for app in "Google Chrome" "Brave Browser" "Microsoft Edge" "Chromium"; do
  if [[ -d "/Applications/$app.app" || -d "$HOME/Applications/$app.app" ]]; then
    open -na "$app" --args --app="$URL" --window-size=1440,900
    exit 0
  fi
done
open "$URL"
