#!/usr/bin/env bash
# Builds Fortuna's release APK on this machine, the same build as .github/workflows/android-apk.yml.
#   mobile/scripts/build-apk.sh
# Needs: the Android SDK (ANDROID_HOME, default ~/Android/Sdk), a JDK 17 or newer, Node with npm.
# Signing is the workflow's: Expo's generated android/ signs release builds with its debug key, so this
# APK installs over one from the workflow. The APK lands in mobile/dist/Fortuna-<short sha>.apk.
# The architecture is arm64 only, like the workflow (FORTUNA_ARCHS=arm64-v8a,x86_64 for more).
set -euo pipefail
mobile="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$mobile/.." && pwd)"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
archs="${FORTUNA_ARCHS:-arm64-v8a}"

fail() { echo "$*" >&2; exit 1; }
[ -d "$ANDROID_HOME/platforms" ] && [ -n "$(ls -A "$ANDROID_HOME/platforms")" ] \
  || fail "No Android SDK at $ANDROID_HOME (set ANDROID_HOME)."
[ -d "$ANDROID_HOME/build-tools" ] && [ -n "$(ls -A "$ANDROID_HOME/build-tools")" ] \
  || fail "The Android SDK at $ANDROID_HOME has no build-tools: install them with sdkmanager."
for tool in java keytool unzip git node npm; do
  command -v "$tool" >/dev/null || fail "$tool isn't installed."
done
java_major="$(java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1)"
[ "${java_major:-0}" -ge 17 ] || fail "The build needs JDK 17 or newer; java is ${java_major:-unknown}."
sha="$(git -C "$root" rev-parse --short HEAD)" || fail "$root isn't a git checkout."

# Gradle and the Kotlin daemon write their temp files into a folder of this build's on disk, removed
# on exit, rather than into /tmp (a small tmpfs on the Zenbook).
tmp="$(mkdir -p "${XDG_CACHE_HOME:-$HOME/.cache}" && mktemp -d "${XDG_CACHE_HOME:-$HOME/.cache}/fortuna-apk.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
export TMPDIR="$tmp" JAVA_TOOL_OPTIONS="-Djava.io.tmpdir=$tmp${JAVA_TOOL_OPTIONS:+ $JAVA_TOOL_OPTIONS}"
# Headless: Expo doesn't stop to ask (e.g. about uncommitted changes before prebuild --clean).
export CI=1

cd "$mobile"
if ! cmp -s package-lock.json node_modules/.fortuna-lock; then
  npm ci --no-audit --no-fund || fail "The app's packages couldn't be installed (npm ci in mobile)."
  cp package-lock.json node_modules/.fortuna-lock
fi
npm run typecheck || fail "The app doesn't typecheck (npm run typecheck in mobile)."
npm run check || fail "Expo's package versions don't match the SDK (npm run check in mobile)."

npx expo prebuild --platform android --no-install --clean \
  || fail "Expo couldn't generate the Android project (expo prebuild in mobile)."
./android/gradlew -p android assembleRelease --no-daemon -PreactNativeArchitectures="$archs" \
  || fail "The Gradle release build failed."

apk="$mobile/android/app/build/outputs/apk/release/app-release.apk"
[ -s "$apk" ] || fail "Gradle left no APK at $apk."
tools="$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -1)"
# The key the workflow's APKs are signed with: the debug key Expo's template puts in android/app
# (its password is the well-known "android", not a secret).
want="$(keytool -list -keystore android/app/debug.keystore -alias androiddebugkey -storepass android -v 2>/dev/null \
  | sed -n 's/^\s*SHA256: //p' | tr -d ':' | tr 'A-F' 'a-f')"
got="$("${tools}apksigner" verify --print-certs "$apk" | sed -n 's/.*certificate SHA-256 digest: //p' | head -1)"
[ -n "$want" ] && [ "$want" = "$got" ] || fail "The APK isn't signed with the workflow's key (got ${got:-nothing})."
badging="$("${tools}aapt2" dump badging "$apk")"
grep -q "^package: name='app.fortuna.mobile'" <<<"$badging" || fail "The APK isn't app.fortuna.mobile."

# Only this build in dist/, so mobile/dist/*.apk is one file.
mkdir -p dist
find dist -maxdepth 1 -name 'Fortuna-*.apk' -delete
out="$mobile/dist/Fortuna-$sha.apk"
cp "$apk" "$out"
version="$(sed -n "s/^package: .*versionName='\([^']*\)'.*/\1/p" <<<"$badging")"
echo "Built ${out#"$root"/} ($(du -h "$out" | cut -f1), version $version, $archs), signed with the workflow's key."
