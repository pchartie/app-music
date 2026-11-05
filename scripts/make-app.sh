#!/bin/zsh
# Crée ~/Applications/Discothèque.app, une icône à double-cliquer qui lance scripts/launch.sh.
ROOT="${0:A:h:h}"
mkdir -p "$HOME/Applications"
osacompile -o "$HOME/Applications/Discothèque.app" -e "do shell script \"zsh '$ROOT/scripts/launch.sh' > /dev/null 2>&1 &\""
echo "✓ $HOME/Applications/Discothèque.app"
