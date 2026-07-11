#! /bin/bash

# Generates a simple index.html for the GitHub Pages site listing every CSV
# in scraped/, so the latest scrape is browsable/downloadable directly from
# https://<user>.github.io/apoc-data/ in addition to the GitHub releases.
set -euo pipefail

dir="${1:-scraped}"
out="${dir}/index.html"

scraped_on="$(TZ='America/Anchorage' date)"

{
    cat <<HTML
<!doctype html>
<meta charset="utf-8">
<title>APOC Data — latest scrape</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 3rem auto; padding: 0 1rem; }
  li { margin: 0.35rem 0; }
  .meta { color: #666; }
</style>
<h1>APOC Data — latest scrape</h1>
<p class="meta">Scraped on ${scraped_on}. Also available from the
<a href="https://github.com/NickCrews/apoc-data/releases/latest">GitHub releases</a>.</p>
<ul>
HTML

    for f in "${dir}"/*.csv "${dir}"/*.csv.zip; do
        [ -e "$f" ] || continue
        name="$(basename "$f")"
        size="$(du -h "$f" | cut -f1)"
        printf '  <li><a href="%s">%s</a> <span class="meta">(%s)</span></li>\n' "$name" "$name" "$size"
    done

    cat <<HTML
</ul>
HTML
} > "$out"

echo "Wrote ${out}"
