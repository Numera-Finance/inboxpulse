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

# Drive filenames. Every one starts with InboxPulse so a search for the product
# finds the whole set, and keeps the source's number so a cross-reference like
# "see 03-ARCHITECTURE.md" still lands the reader on the right document.
docx_name() {
  case "$1" in
    README)                     echo "InboxPulse 00 Read this first" ;;
    00-GLOSSARY)                echo "InboxPulse 00 Terms and glossary" ;;
    01-WHY)                     echo "InboxPulse 01 Why it exists" ;;
    02-WHAT-IT-DOES)            echo "InboxPulse 02 What a user sees" ;;
    03-ARCHITECTURE)            echo "InboxPulse 03 Architecture" ;;
    04-DATA-MODEL)              echo "InboxPulse 04 Data model" ;;
    05-PIPELINE)                echo "InboxPulse 05 Pipeline" ;;
    06-SIGNALS)                 echo "InboxPulse 06 Signals" ;;
    07-DESIGN-PRINCIPLES)       echo "InboxPulse 07 Design principles" ;;
    08-OPERATIONS)              echo "InboxPulse 08 Operations" ;;
    09-DEAD-ENDS)               echo "InboxPulse 09 Dead ends" ;;
    10-NEXT-INTEGRATIONS)       echo "InboxPulse 10 Next integrations" ;;
    11-ACCESS-AND-FIRST-RESPONSE) echo "InboxPulse 11 Access and first response" ;;
    12-PERFORMANCE)             echo "InboxPulse 12 Performance" ;;
    CHANGELOG)                  echo "InboxPulse 13 Changelog" ;;
    *)                          echo "InboxPulse $1" ;;
  esac
}

fail=0
for f in "$SRC"/*.md; do
  base="$(basename "$f" .md)"
  title="$(grep -m1 '^# ' "$f" | sed 's/^# //')"
  out_name="$(docx_name "$base")"

  sed -e 's#(diagrams/architecture\.svg)#(diagrams/architecture.png)#' \
      "$f" > "$TMP/$base.md"

  pandoc "$TMP/$base.md" \
    -f gfm -t docx \
    --toc --toc-depth=2 \
    --resource-path="$TMP" \
    --metadata title="$out_name" \
    -o "$OUT/$out_name.docx" || fail=1
done

echo "built $(ls "$OUT" | wc -l | tr -d ' ') files in $OUT"
exit $fail
