#!/bin/bash
# Builds "AE MCP Bridge.plugin" (universal arm64 + x86_64) from the After Effects SDK.
#   AE_SDK=/path/to/Examples ./build.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SDK="${AE_SDK:-$HERE/../AfterEffectsSDK_25.6_61_mac/ae25.6_61.64bit.AfterEffectsSDK/Examples}"
if [ ! -f "$SDK/Headers/AE_GeneralPlug.h" ]; then
  echo "[aegp] After Effects SDK not found at $SDK (set AE_SDK to its Examples folder)" >&2
  exit 1
fi

OUT="$HERE/build/AE MCP Bridge.plugin"
OBJ="$HERE/build/obj"
SYSROOT="$(xcrun --show-sdk-path)"
INC=(-I"$SDK/Headers" -I"$SDK/Headers/SP" -I"$SDK/Util" -I"$SDK/Resources")
ARCHS=(-arch arm64 -arch x86_64)

rm -rf "$OUT" "$OBJ"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources" "$OBJ"

for src in "$HERE/AEMCPBridge.cpp" "$SDK/Util/AEGP_SuiteHandler.cpp" "$SDK/Util/MissingSuiteError.cpp"; do
  clang++ -std=c++17 -O2 -fvisibility=hidden -mmacosx-version-min=11.0 "${ARCHS[@]}" \
    -isysroot "$SYSROOT" "${INC[@]}" -c "$src" -o "$OBJ/$(basename "${src%.*}").o"
done

clang++ -bundle -mmacosx-version-min=11.0 "${ARCHS[@]}" -isysroot "$SYSROOT" \
  "$OBJ"/*.o -framework CoreFoundation -o "$OUT/Contents/MacOS/AEMCPBridge"

# The PiPL resource is how After Effects finds the entry point.
xcrun Rez -o "$OUT/Contents/Resources/AEMCPBridge.rsrc" -useDF \
  -d SystemSevenOrLater=1 -d __MACH__ "${ARCHS[@]}" -isysroot "$SYSROOT" \
  -i "$SDK/Headers" -i "$SDK/Headers/SP" -i "$SDK/Resources" \
  "$HERE/AEMCPBridge_PiPL.r"

cp "$HERE/Info.plist" "$OUT/Contents/Info.plist"
printf 'AEgxFXTC' > "$OUT/Contents/PkgInfo"
codesign --force --sign - "$OUT" >/dev/null 2>&1 || true

echo "[aegp] Built $OUT"
