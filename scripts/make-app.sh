#!/bin/zsh
# Crée ~/Applications/Discothèque.app, une icône à double-cliquer qui lance scripts/launch.sh,
# et un raccourci « Discothèque » sur le bureau (s'il n'y en a pas déjà un).
ROOT="${0:A:h:h}"
APP="$HOME/Applications/Discothèque.app"
LINK="$HOME/Desktop/Discothèque"
mkdir -p "$HOME/Applications"
osacompile -o "$APP" -e "do shell script \"zsh '$ROOT/scripts/launch.sh' > /dev/null 2>&1 &\"" || exit 1
echo "✓ $APP"
if [ -d "$HOME/Desktop" ] && [ ! -e "$LINK" ] && [ ! -L "$LINK" ]; then
  ln -s "$APP" "$LINK" && echo "✓ raccourci sur le bureau"
fi
