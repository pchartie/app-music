#!/bin/zsh
# Crée ~/Applications/App Music.app, une icône à double-cliquer qui lance scripts/launch.sh,
# et un raccourci « App Music » sur le bureau (s'il n'y en a pas déjà un).
ROOT="${0:A:h:h}"
APP="$HOME/Applications/App Music.app"
LINK="$HOME/Desktop/App Music"
mkdir -p "$HOME/Applications"
osacompile -o "$APP" -e "do shell script \"zsh '$ROOT/scripts/launch.sh' > /dev/null 2>&1 &\"" || exit 1
# icône de l'app (même dessin que le favicon : public/icon.svg -> assets/AppIcon.icns, npm run make-icon)
if [ -f "$ROOT/assets/AppIcon.icns" ]; then
  cp "$ROOT/assets/AppIcon.icns" "$APP/Contents/Resources/applet.icns"
  rm -f "$APP/Contents/Resources/Assets.car"   # sinon macOS garde l'icône de script par défaut
  /usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$APP/Contents/Info.plist" 2>/dev/null
  codesign --force --deep -s - "$APP" 2>/dev/null   # signature locale refaite après modification
  touch "$APP"
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" 2>/dev/null
fi
echo "✓ $APP"
if [ -d "$HOME/Desktop" ] && [ ! -e "$LINK" ] && [ ! -L "$LINK" ]; then
  ln -s "$APP" "$LINK" && echo "✓ raccourci sur le bureau"
fi
