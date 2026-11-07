#!/bin/zsh
# Démarre le serveur App Music s'il ne tourne pas, puis ouvre l'interface dans le navigateur par défaut.
ROOT="${0:A:h:h}"
PORT="${PORT:-4321}"
URL="http://localhost:$PORT"
export PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# Serveur lancé avant une mise à jour du code (git pull…) : on le redémarre, sinon les nouveautés
# de l'interface parleraient à un ancien serveur
STATUS=$(curl -s "$URL/api/status")
if [[ -n "$STATUS" ]] && cd "$ROOT" && print -r -- "$STATUS" | node scripts/server-stale.mjs; then
  PID=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN)
  [[ -n "$PID" ]] && kill $PID
  for i in {1..40}; do curl -s -o /dev/null "$URL/api/status" || break; sleep 0.25; done
fi

if ! curl -s -o /dev/null "$URL/api/status"; then
  mkdir -p "$ROOT/cache"
  cd "$ROOT" && nohup node server.js > "$ROOT/cache/server.log" 2>&1 &
  for i in {1..60}; do curl -s -o /dev/null "$URL/api/status" && break; sleep 0.25; done
fi

open "$URL"
