#!/usr/bin/env bash
# Rebuild the map data end-to-end. Run pipeline/01_fetch.sh once first.
#
# Default: Wexford fixture (small, local) used for development.
# --statewide: all-Republic 2025 build. Artifacts stay local and gitignored.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="wexford"
if [[ "${1:-}" == "--statewide" ]]; then
  MODE="statewide"
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--statewide]" >&2
  exit 1
fi

WORK="${GOIRT_WORK_DIR:-$ROOT/data/work}"
OUT="$WORK/$MODE"

if [[ ! -f "$WORK/GEO_860-PARCELS_GPK.gpkg" ]]; then
  echo "source GeoPackage missing; run pipeline/01_fetch.sh first" >&2
  exit 1
fi

uv sync
uv run python pipeline/02_inspect.py
uv run python pipeline/03_lookup.py --check
if [[ "$MODE" == "statewide" ]]; then
  uv run python pipeline/04_process.py --statewide
  uv run python pipeline/07_crops_json.py \
    --fields "$OUT/fields.fgb" \
    --out "$ROOT/site/public/data/crops-full.json"
  uv run python pipeline/08_overview.py --statewide
  bash pipeline/05_tiles.sh --statewide
  bash pipeline/06_basemap.sh --statewide
  uv run python pipeline/privacy_scan.py \
    "$OUT/fields.fgb" \
    "$OUT/fields.geojson" \
    "$ROOT/site/public/fixtures/fields-2025-v1.pmtiles" \
    "$OUT/overview.geojson" \
    "$ROOT/site/public/data/overview-2025-v1.pmtiles"
else
  uv run python pipeline/04_process.py
  uv run python pipeline/07_crops_json.py
  uv run python pipeline/07_crops_json.py \
    --fields "$OUT/fields.fgb" \
    --out "$ROOT/site/public/data/crops-full.json"
  uv run python pipeline/08_overview.py
  bash pipeline/05_tiles.sh
  bash pipeline/06_basemap.sh
  uv run python pipeline/privacy_scan.py
fi

uv run python pipeline/09_places.py

cat <<EOF

Fixtures rebuilt ($MODE). To point the local app at the full map:
  cp site/.env.full.example site/.env.local
  pnpm --dir site dev
EOF
