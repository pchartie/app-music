#!/bin/zsh
# Installe (ou met à jour) App Music en une seule commande, sans droits administrateur :
#
#   curl -fsSL https://raw.githubusercontent.com/pchartie/app-music/main/install.sh | zsh
#
# - télécharge Node.js dans ~/.local/node s'il n'est pas déjà présent (version 18 ou plus) ;
# - télécharge l'app dans ~/AppMusic (une mise à jour garde le cache et le réglage du dossier de musique) ;
# - installe les dépendances, puis lance l'app : l'écran d'accueil demande le dossier de musique,
#   et un raccourci « App Music » est ajouté sur le bureau.

main() {
  set -e
  local REPO=pchartie/app-music
  local DEST="${APPMUSIC_HOME:-$HOME/AppMusic}"
  local NODE_DIR="$HOME/.local/node"
  export PATH="$NODE_DIR/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
  say() { print -P "%F{green}›%f $1"; }

  [[ "$(uname)" = Darwin ]] || { echo "App Music fonctionne sur macOS uniquement."; exit 1; }

  # 1. Node.js
  if ! command -v node > /dev/null || (( $(node -p 'process.versions.node.split(".")[0]') < 18 )); then
    local arch=$(uname -m); [[ $arch = x86_64 ]] && arch=x64
    local base=https://nodejs.org/dist/latest-v22.x
    local sums=$(curl -fsSL "$base/SHASUMS256.txt")
    local file=$(print -r -- "$sums" | awk -v f="darwin-$arch.tar.gz" '$2 ~ f"$" { print $2 }')
    local tmp=$(mktemp -d)
    say "Téléchargement de Node.js ($file)…"
    curl -fL# -o "$tmp/$file" "$base/$file"
    (cd "$tmp" && print -r -- "$sums" | grep " $file\$" | shasum -a 256 -c --status) || { echo "Téléchargement de Node.js corrompu."; exit 1; }
    rm -rf "$NODE_DIR"; mkdir -p "$NODE_DIR"
    tar xzf "$tmp/$file" --strip-components 1 -C "$NODE_DIR"
    rm -rf "$tmp"
  fi
  say "Node.js $(node -v)"

  # 2. L'app (sauf si on est déjà dans une copie, par ex. un zip décompressé ou un clone Git)
  if [[ -f "${0:A:h}/server.js" && -f "${0:A:h}/install.sh" ]]; then
    DEST="${0:A:h}"
  elif [[ ! -d "$DEST/.git" ]]; then
    say "Téléchargement de App Music dans ${DEST/#$HOME/~}…"
    mkdir -p "$DEST"
    curl -fsSL "https://github.com/$REPO/archive/refs/heads/main.tar.gz" | tar xz --strip-components 1 -C "$DEST"
  fi
  cd "$DEST"

  # 3. Dépendances, puis lancement
  say "Installation des dépendances…"
  npm install --omit=dev --no-audit --no-fund --loglevel=error --update-notifier=false > /dev/null
  say "C'est prêt. Prochaine fois : double-clic sur « App Music » sur le bureau."
  [[ -n "$APPMUSIC_NO_LAUNCH" ]] || zsh scripts/launch.sh
}

main "$@"
