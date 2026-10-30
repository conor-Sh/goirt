#!/usr/bin/env bash
# Download and verify the 2025 LPIS parcels archive, then extract its GeoPackage.
# The archive is about 2.9 GB and the extracted GeoPackage is about 5.3 GB.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${GOIRT_WORK_DIR:-$ROOT/data/work}"
URL="https://opendata.agriculture.gov.ie/dataset/40d859ac-58a8-4082-98d2-4ebf1c7cdd29/resource/bd5a8a3b-cc9f-498d-9f40-dc7006d4efee/download/geo_860-parcels_gpk_2025.zip"
ARCHIVE="$WORK/geo_860-parcels_gpk_2025.zip"
SHA256="c9b2ea2ea4ac517c6bb9ae304aec7d6d2553317e959203b8507a9c8f2ff3c502"
GPKG="$WORK/GEO_860-PARCELS_GPK.gpkg"
EXPECTED_BYTES=2910851366

mkdir -p "$WORK"

if [[ ! -f "$ARCHIVE" ]]; then
  echo "downloading $URL"
  curl --fail --location --retry 3 --continue-at - --output "$ARCHIVE" "$URL"
fi

actual_bytes="$(stat --printf='%s' "$ARCHIVE")"
if [[ "$actual_bytes" != "$EXPECTED_BYTES" ]]; then
  echo "unexpected archive size: $actual_bytes (expected $EXPECTED_BYTES)" >&2
  exit 1
fi
echo "$SHA256  $ARCHIVE" | sha256sum --check --status
echo "archive verified: $SHA256"

if [[ ! -f "$GPKG" ]]; then
  echo "extracting $ARCHIVE"
  unzip -o "$ARCHIVE" -d "$WORK"
fi
echo "source ready: $GPKG"
