#!/bin/zsh
# Installe la reconnaissance vocale hors ligne (whisper.cpp + modèle « small » quantifié).
# Tout est placé dans ~/AppMusic/tools (ignoré par Git). Usage : npm run install-voice
set -e
ROOT="${0:A:h:h}"
TOOLS="$ROOT/tools"
mkdir -p "$TOOLS"
export PATH="$HOME/Library/Python/3.9/bin:$PATH"
if ! command -v cmake >/dev/null; then
  echo "→ Installation de cmake (pip, dossier utilisateur)"
  python3 -m pip install --user --quiet cmake
fi
if [ ! -d "$TOOLS/whisper.cpp" ]; then
  echo "→ Téléchargement de whisper.cpp"
  git clone --depth 1 --branch v1.7.6 https://github.com/ggml-org/whisper.cpp "$TOOLS/whisper.cpp"
fi
cd "$TOOLS/whisper.cpp"
if [ ! -x build/bin/whisper-cli ]; then
  echo "→ Compilation (quelques minutes)"
  cmake -B build -DCMAKE_BUILD_TYPE=Release -DWHISPER_SDL2=OFF -DGGML_METAL=OFF -DBUILD_SHARED_LIBS=OFF >/dev/null
  cmake --build build -j --config Release --target whisper-cli >/dev/null
fi
MODEL="$TOOLS/ggml-small-q5_1.bin"
if [ ! -f "$MODEL" ]; then
  echo "→ Téléchargement du modèle (≈190 Mo)"
  curl -L --fail -o "$MODEL.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin"
  mv "$MODEL.part" "$MODEL"
fi
echo "✓ Reconnaissance vocale prête : $TOOLS/whisper.cpp/build/bin/whisper-cli"
