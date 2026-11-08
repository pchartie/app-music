#!/bin/sh
# Installe (ou met à jour) App Music sur macOS ou Linux, en une seule commande, sans droits administrateur :
#
#   curl -fsSL https://raw.githubusercontent.com/pchartie/app-music/main/install.sh | sh
#
# (sous Windows : install.ps1)
# - télécharge Node.js dans ~/.local/node s'il n'est pas déjà présent (version 20 ou plus) ;
# - télécharge l'app dans ~/AppMusic (une mise à jour garde le cache et le réglage du dossier de musique) ;
# - installe les dépendances, puis lance l'app : l'écran d'accueil demande le dossier de musique,
#   et « App Music » est ajoutée sur le bureau (et dans le menu des applications sous Linux).

main() {
  set -e
  REPO=pchartie/app-music
  DEST="${APPMUSIC_HOME:-$HOME/AppMusic}"
  NODE_DIR="$HOME/.local/node"
  export PATH="$NODE_DIR/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
  say() { printf '\033[32m›\033[0m %s\n' "$1"; }

  case "$(uname)" in
    Darwin) OS=darwin ;;
    Linux) OS=linux ;;
    *) echo "Système non reconnu. Sous Windows, utilisez install.ps1 (voir le README)."; exit 1 ;;
  esac

  # 1. Node.js
  if ! command -v node > /dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
    case "$(uname -m)" in
      x86_64 | amd64) ARCH=x64 ;;
      arm64 | aarch64) ARCH=arm64 ;;
      *) echo "Processeur non pris en charge : $(uname -m)"; exit 1 ;;
    esac
    BASE=https://nodejs.org/dist/latest-v24.x
    SUMS=$(curl -fsSL "$BASE/SHASUMS256.txt")
    FILE=$(printf '%s\n' "$SUMS" | awk -v f="$OS-$ARCH.tar.gz" '$2 ~ f"$" { print $2 }')
    TMP=$(mktemp -d)
    say "Téléchargement de Node.js ($FILE)…"
    curl -fL# -o "$TMP/$FILE" "$BASE/$FILE"
    if command -v sha256sum > /dev/null; then CHECK="sha256sum -c --status"; else CHECK="shasum -a 256 -c --status"; fi
    (cd "$TMP" && printf '%s\n' "$SUMS" | grep " $FILE\$" | $CHECK) || { echo "Téléchargement de Node.js corrompu."; exit 1; }
    rm -rf "$NODE_DIR"; mkdir -p "$NODE_DIR"
    tar xzf "$TMP/$FILE" --strip-components 1 -C "$NODE_DIR"
    rm -rf "$TMP"
  fi
  say "Node.js $(node -v)"

  # 2. L'app (sauf si on est déjà dans une copie, par ex. un zip décompressé ou un clone Git)
  SELF=$(cd "$(dirname "$0")" 2> /dev/null && pwd || true)
  if [ -n "$SELF" ] && [ -f "$SELF/server.js" ] && [ -f "$SELF/install.sh" ]; then
    DEST="$SELF"
  elif [ ! -d "$DEST/.git" ]; then
    say "Téléchargement de App Music dans $DEST…"
    mkdir -p "$DEST"
    curl -fsSL "https://github.com/$REPO/archive/refs/heads/main.tar.gz" | tar xz --strip-components 1 -C "$DEST"
  fi
  cd "$DEST"

  # 3. Dépendances, puis lancement
  say "Installation des dépendances…"
  npm install --omit=dev --no-audit --no-fund --loglevel=error --update-notifier=false > /dev/null
  say "C'est prêt. Prochaine fois : double-clic sur « App Music » sur le bureau."
  [ -n "$APPMUSIC_NO_LAUNCH" ] || node scripts/launch.mjs
}

main "$@"
