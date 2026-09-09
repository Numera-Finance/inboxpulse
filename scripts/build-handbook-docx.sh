#!/usr/bin/env bash
# Convert the handbook to .docx for the Drive copy the UAT group reads.
#
# The markdown references diagrams/architecture.svg, which GitHub renders
# inline. pandoc cannot rasterize SVG without rsvg-convert, so this swaps the
# reference to the PNG that scripts/build-diagrams.py writes from the same
# layout. The PNG carries a DPI that gives it a 6.2in print width, because gfm
# does not support link_attributes and `{width=...}` is therefore unavailable.
#
# Output lands in .scratch/, which is gitignored: these files carry real client
# names.
#
# Usage:  bash scripts/build-handbook-docx.sh
set -euo pipefail

cd "$(dirname "$0")/.."
SRC="docs/handbook"
OUT=".scratch/InboxPulse Handbook"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

command -v pandoc >/dev/null || { echo "pandoc not installed"; exit 1; }

python3 scripts/build-diagrams.py

rm -rf "$OUT"
mkdir -p "$OUT"
cp -R "$SRC/diagrams" "$TMP/diagrams"

fail=0
for f in "$SRC"/*.md; do
  base="$(basename "$f" .md)"
  title="$(grep -m1 '^# ' "$f" | sed 's/^# //')"

  sed -e 's#(diagrams/architecture\.svg)#(diagrams/architecture.png)#' \
      "$f" > "$TMP/$base.md"

  pandoc "$TMP/$base.md" \
    -f gfm -t docx \
    --toc --toc-depth=2 \
    --resource-path="$TMP" \
    --metadata title="${title:-$base}" \
    -o "$OUT/$base.docx" || fail=1
done

echo "built $(ls "$OUT" | wc -l | tr -d ' ') files in $OUT"
exit $fail
