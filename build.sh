#!/data/data/com.termux/files/usr/bin/bash
# Test and build Pinprick on the phone.
#   ./build.sh          tests + dist/pinprick.html and dist/artifact.html
#   ./build.sh apk      also builds and signs android/build/pinprick.apk
#   ./build.sh smoke    also plays the build in headless Chromium (screenshots in .tmp/shots)
# Uses Termux packages: nodejs, aapt2, d8, apksigner, openjdk-21, plus android.jar (API 35).
set -euo pipefail
cd "$(dirname "$0")"

echo "== tests"
node --test 'test/*.test.js' 2>&1 | grep -E '^ℹ (tests|pass|fail)|^✖' || true
node --test 'test/*.test.js' >/dev/null 2>&1 || { echo "tests failed"; exit 1; }

echo "== web build"
node tools/build.mjs

if [ "${1:-}" = "smoke" ]; then
  echo "== smoke test"
  node tools/smoke.mjs
fi

if [ "${1:-}" = "apk" ]; then
  ANDROID_JAR="${ANDROID_JAR:-$HOME/android-sdk/platforms/android-35/android.jar}"
  # Keep this keystore: updates to the installed app must be signed with the same key.
  KEYSTORE="${KEYSTORE:-$HOME/.android/pinprick.keystore}"
  VERSION_CODE="${VERSION_CODE:-2}"
  VERSION_NAME="$(node -p "require('./package.json').version")"
  B=android/build
  rm -rf "$B"; mkdir -p "$B/classes" "$B/dex" "$B/assets"
  cp dist/pinprick.html "$B/assets/index.html"

  echo "== apk resources"
  aapt2 compile --dir android/res -o "$B/res.zip"
  aapt2 link -o "$B/unsigned.apk" -I "$ANDROID_JAR" --manifest android/AndroidManifest.xml -A "$B/assets" \
    --min-sdk-version 31 --target-sdk-version 35 \
    --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" "$B/res.zip"

  echo "== apk java"
  javac --release 11 -classpath "$ANDROID_JAR" -d "$B/classes" $(find android/src -name '*.java')
  d8 --release --min-api 31 --lib "$ANDROID_JAR" --output "$B/dex" $(find "$B/classes" -name '*.class')
  python3 -I -c 'import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "a", zipfile.ZIP_DEFLATED) as z:
    z.write(sys.argv[2], "classes.dex")' "$B/unsigned.apk" "$B/dex/classes.dex"

  echo "== apk sign"
  zipalign -f -p 4 "$B/unsigned.apk" "$B/aligned.apk"
  if [ ! -f "$KEYSTORE" ]; then
    mkdir -p "$(dirname "$KEYSTORE")"
    keytool -genkeypair -keystore "$KEYSTORE" -storepass android -keypass android -alias pinprick \
      -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Pinprick (personal)" >/dev/null
  fi
  apksigner sign --ks "$KEYSTORE" --ks-pass pass:android --ks-key-alias pinprick --out "$B/pinprick.apk" "$B/aligned.apk"
  apksigner verify "$B/pinprick.apk"
  ls -la "$B/pinprick.apk"
fi
