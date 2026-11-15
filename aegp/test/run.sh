#!/bin/bash
# AE MCP - https://shivamthapliyal.com
# Copyright (C) 2026 Shivam Thapliyal
# SPDX-License-Identifier: GPL-3.0-or-later

# Builds aegp/test/harness.cpp (the real bridge against fake AEGP suites) and runs bridge.test.js.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SDK="${AE_SDK:-$HERE/../../AfterEffectsSDK_25.6_61_mac/ae25.6_61.64bit.AfterEffectsSDK/Examples}"
OUT="$HERE/../build/test"
mkdir -p "$OUT"

clang++ -std=c++17 -g -fsanitize=address,undefined -isysroot "$(xcrun --show-sdk-path)" \
  -I"$SDK/Headers" -I"$SDK/Headers/SP" -I"$SDK/Util" \
  "$HERE/harness.cpp" "$SDK/Util/AEGP_SuiteHandler.cpp" "$SDK/Util/MissingSuiteError.cpp" \
  -o "$OUT/harness"

export AE_MCP_PORT="${AE_MCP_PORT:-7399}"
exec 3> >("$OUT/harness")
for _ in $(seq 1 50); do nc -z 127.0.0.1 "$AE_MCP_PORT" 2>/dev/null && break; sleep 0.1; done
status=0
node "$HERE/bridge.test.js" || status=$?
exec 3>&-   # closing stdin stops the harness, which runs the death hook
sleep 0.5
exit $status
