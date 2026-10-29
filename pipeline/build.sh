#!/usr/bin/env bash
# Rebuild the Wexford fixture end-to-end. Run pipeline/01_fetch.sh once first.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f "$ROOT/data/work/GEO_860-PARCELS_GPK.gpkg" ]]; then
  echo "source GeoPackage missing; run pipeline/01_fetch.sh first" >&2
  exit 1
fi

uv sync
uv run python pipeline/02_inspect.py
uv run python pipeline/03_lookup.py --check
uv run python pipeline/04_process.py
uv run python pipeline/07_crops_json.py
bash pipeline/05_tiles.sh
bash pipeline/06_basemap.sh

cat <<'EOF'

Fixtures rebuilt. To point the local app at the full Wexford map:
  cp site/.env.full.example site/.env.local
  pnpm --dir site dev
EOF
