#!/usr/bin/env bash
# Tile processed fields into a local PMTiles artifact.
#
# Default: Wexford fixture -> site/public/fixtures/wexford-fields.pmtiles
# --statewide: all-Republic build -> site/public/fixtures/fields-2025-v1.pmtiles
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIPPECANOE="${TIPPECANOE:-tippecanoe}"
WORK="${GOIRT_WORK_DIR:-$ROOT/data/work}"
SCOPE="wexford"
if [[ "${1:-}" == "--statewide" ]]; then
  SCOPE="statewide"
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--statewide]" >&2
  exit 1
fi

if [[ "$SCOPE" == "statewide" ]]; then
  INPUT="$WORK/statewide/fields.fgb"
  OUTPUT="$ROOT/site/public/fixtures/fields-2025-v1.pmtiles"
  EXTRA=()
else
  INPUT="$WORK/wexford/fields.geojson"
  OUTPUT="$ROOT/site/public/fixtures/wexford-fields.pmtiles"
  EXTRA=(--maximum-tile-bytes=1500000)
fi

if ! command -v "$TIPPECANOE" >/dev/null 2>&1; then
  echo "tippecanoe not found. Set TIPPECANOE=/path/to/tippecanoe." >&2
  echo "See docs/DATA.md for the build command." >&2
  exit 1
fi
if [[ ! -f "$INPUT" ]]; then
  if [[ "$SCOPE" == "statewide" ]]; then
    echo "missing $INPUT; run pipeline/04_process.py --statewide first" >&2
  else
    echo "missing $INPUT; run pipeline/04_process.py first" >&2
  fi
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
  "${EXTRA[@]}" \
  "$INPUT"

echo "wrote $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
if [[ -x "$HOME/go/bin/go-pmtiles" ]]; then
  "$HOME/go/bin/go-pmtiles" show "$OUTPUT" | sed -n '1,8p'
fi
