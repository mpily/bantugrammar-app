#!/usr/bin/env bash
# Assemble the static site into _site/ (used by CI for GitHub Pages and for local preview):
#   _site/index.html, style.css, js/   <- site/
#   _site/data/                        <- data/ (tables the page and the oracle read)
#   _site/kitaita_oracle/              <- the Python oracle, loaded into Pyodide
# Preview:  scripts/build_site.sh && python3 -m http.server -d _site 8000
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf _site
mkdir -p _site/kitaita_oracle
cp -r site/. _site/
cp -r data _site/data
cp kitaita_oracle/*.py _site/kitaita_oracle/
touch _site/.nojekyll

# Cache-busting: GitHub Pages lets browsers cache files ~10 min, so after a deploy a
# page could load a new module next to an old cached one. Stamp every JS/CSS link
# with the build version so all files of one deploy are fetched together.
VERSION="${BUILD_VERSION:-$(git rev-parse --short=12 HEAD 2>/dev/null || date +%s)}"
for f in _site/*.html; do
  sed -i -E "s#(src|href)=\"(js/[^\"?]+\.js|style\.css)\"#\1=\"\2?v=${VERSION}\"#g" "$f"
done
sed -i -E "s#^export const BUILD_VERSION = \"dev\";#export const BUILD_VERSION = \"${VERSION}\";#" _site/js/config.js
for f in _site/js/*.js; do
  sed -i -E "s#from \"(\./[^\"?]+\.js)\"#from \"\1?v=${VERSION}\"#g" "$f"
done
echo "built _site/ ($(du -sh _site | cut -f1))"
