#!/bin/zsh
# Crée ~/Applications/App Music.app, une icône à double-cliquer qui lance scripts/launch.sh,
# et un raccourci « App Music » sur le bureau (s'il n'y en a pas déjà un).
ROOT="${0:A:h:h}"
APP="$HOME/Applications/App Music.app"
LINK="$HOME/Desktop/App Music"
mkdir -p "$HOME/Applications"
osacompile -o "$APP" -e "do shell script \"zsh '$ROOT/scripts/launch.sh' > /dev/null 2>&1 &\"" || exit 1
echo "✓ $APP"
if [ -d "$HOME/Desktop" ] && [ ! -e "$LINK" ] && [ ! -L "$LINK" ]; then
  ln -s "$APP" "$LINK" && echo "✓ raccourci sur le bureau"
fi
