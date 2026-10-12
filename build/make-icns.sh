#!/bin/sh
# make-icns.sh — build build/icon.icns from build/icon.png (1024x1024)
set -e
cd "$(dirname "$0")"

SET=icon.iconset
rm -rf "$SET"
mkdir "$SET"

for size in 16 32 128 256 512; do
  double=$((size * 2))
  sips -z "$size" "$size"     icon.png --out "$SET/icon_${size}x${size}.png"    >/dev/null
  sips -z "$double" "$double" icon.png --out "$SET/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$SET" -o icon.icns
rm -rf "$SET"
echo "Wrote build/icon.icns"
