#!/usr/bin/env bash
# Extract a Wexford-sized Protomaps basemap from the pinned daily build.
#
# go-pmtiles uses HTTP range requests, so this downloads only the tiles for the
# extract, not the multi-gigabyte planet archive.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PMTILES_BIN="${PMTILES_BIN:-go-pmtiles}"
BUILD="${PROTOMAPS_BUILD:-20261029}"
BBOX="${PROTOMAPS_BBOX:--7.10,52.10,-6.05,52.85}"
OUTPUT="$ROOT/site/public/basemap/wexford.pmtiles"
INPUT="https://build.protomaps.com/${BUILD}.pmtiles"

if ! command -v "$PMTILES_BIN" >/dev/null 2>&1; then
  echo "$PMTILES_BIN not found. Install with:" >&2
  echo "  go install github.com/protomaps/go-pmtiles@latest" >&2
  echo "then set PMTILES_BIN=\$HOME/go/bin/go-pmtiles." >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT")"
"$PMTILES_BIN" extract "$INPUT" "$OUTPUT" \
  --bbox="$BBOX" \
  --maxzoom=15 \
  --download-threads=8 \
  --overfetch=0.1

echo "wrote $OUTPUT (Protomaps build $BUILD)"
