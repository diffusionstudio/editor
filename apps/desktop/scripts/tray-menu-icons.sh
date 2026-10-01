#!/bin/sh
# Regenerates the Windows tray menu icons: assets/tray/menu/<name>.svg ->
# <name>.png (16px) and <name>@2x.png (32px). Black on transparent; the app
# recolors them to match the menu's light or dark theme. macOS uses SF
# Symbols instead and does not need these.
#
# Needs rsvg-convert (brew install librsvg).

set -e
cd "$(dirname "$0")/../assets/tray/menu"
for svg in *.svg; do
  name="${svg%.svg}"
  rsvg-convert -w 16 -h 16 "$svg" -o "$name.png"
  rsvg-convert -w 32 -h 32 "$svg" -o "$name@2x.png"
done
