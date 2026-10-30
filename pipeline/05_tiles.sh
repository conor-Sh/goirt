#!/usr/bin/env bash
# Tile the processed Wexford GeoJSON into the local field PMTiles fixture.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIPPECANOE="${TIPPECANOE:-tippecanoe}"
WORK="${GOIRT_WORK_DIR:-$ROOT/data/work}"
INPUT="$WORK/wexford/fields.geojson"
OUTPUT="$ROOT/site/public/fixtures/wexford-fields.pmtiles"

if ! command -v "$TIPPECANOE" >/dev/null 2>&1; then
  echo "tippecanoe not found. Set TIPPECANOE=/path/to/tippecanoe." >&2
  echo "See docs/DATA.md for the build command." >&2
  exit 1
fi
if [[ ! -f "$INPUT" ]]; then
  echo "missing $INPUT; run pipeline/04_process.py first" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT")"
"$TIPPECANOE" --force \
  -o "$OUTPUT" \
  -Z10 -z14 -B9 \
  -l fields \
  --generate-ids \
  --simplification=2 \
  --detect-shared-borders \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --maximum-tile-bytes=1500000 \
  "$INPUT"

echo "wrote $OUTPUT"
if [[ -x "$HOME/go/bin/go-pmtiles" ]]; then
  "$HOME/go/bin/go-pmtiles" show "$OUTPUT" | sed -n '1,8p'
fi
