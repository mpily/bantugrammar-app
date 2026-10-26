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
echo "built _site/ ($(du -sh _site | cut -f1))"
