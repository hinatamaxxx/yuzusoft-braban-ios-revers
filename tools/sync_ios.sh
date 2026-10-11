#!/usr/bin/env bash
# Sync the iOS project and the web game root into the WSL build directory (~/braban-ios).
set -euo pipefail
SRC="/mnt/c/Codex/yuzusofut revers"
DST="$HOME/braban-ios"
mkdir -p "$DST/Braban"
# project sources (keep .build / xtool caches)
cp -f "$SRC/ios/Package.swift" "$SRC/ios/xtool.yml" "$DST/"
rm -rf "$DST/LocalBuild" "$DST/Braban/Assets.xcassets"
cp -r "$SRC/ios/LocalBuild" "$DST/"
cp -r "$SRC/ios/Braban/Assets.xcassets" "$DST/Braban/"
cp -f "$SRC/ios/Braban/"*.swift "$DST/Braban/"
# game web root
if [ "${1:-}" = "--full" ] || [ ! -d "$DST/Braban/Game/i" ]; then
  rm -rf "$DST/Braban/Game"
  cp -r "$SRC/game" "$DST/Braban/Game"
else
  # code/data only (media unchanged)
  rm -rf "$DST/Braban/Game/js" "$DST/Braban/Game/css" "$DST/Braban/Game/data"
  cp -r "$SRC/game/js" "$SRC/game/css" "$SRC/game/data" "$DST/Braban/Game/"
  cp -f "$SRC/game/index.html" "$DST/Braban/Game/"
fi
find "$DST" -path "$DST/Braban/Game" -prune -o -path "$DST/.build" -prune -o -type f \( -name '*.swift' -o -name '*.yml' -o -name '*.plist' -o -name '*.json' \) -print0 | xargs -0 sed -i 's/\r$//'
du -sh "$DST/Braban/Game"
find "$DST/Braban/Game" -type f | wc -l
