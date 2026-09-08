#! /bin/bash

# Assembles everything published to GitHub Pages into one directory:
#
#   _site/
#     index.html, assets/     the explorer app (see web/)
#     data/*.parquet          typed parquet + manifest.json
#     *.csv, *.csv.zip        the raw scrape, at the URLs it has always had
#     apoc-csvs.zip           every CSV in one file, to upload somewhere
#     llms.txt                the schema and caveats, for AI agents
#
# The app lists every one of those files -- one tab per file -- so there is no
# separate index page to generate.
#
# Usage: scripts/build_site.sh [scraped_dir] [out_dir]
set -euo pipefail

scraped="${1:-scraped}"
out="${2:-_site}"
root="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -d "$scraped" ]; then
    echo "No such directory: $scraped" >&2
    echo "Scrape first (apoc-data scrape --directory $scraped) or pass the directory." >&2
    exit 1
fi

rm -rf "$out"
mkdir -p "$out"

echo "==> Building the app"
(cd "$root/web" && npm run build)
# Copy the app first: a developer's local dev data in web/public/data ends up
# in the build, and the freshly converted parquet below should win.
cp -R "$root/web/dist/." "$out/"

echo "==> Converting CSVs to parquet"
uv run apoc-data convert --source "$scraped" --destination "$out/data"

echo "==> Copying the raw CSVs"
for f in "$scraped"/*.csv "$scraped"/*.csv.zip; do
    [ -e "$f" ] || continue
    cp "$f" "$out/"
done

# One archive of every CSV, for the AI tools that can't fetch a URL: ChatGPT
# and Gemini will only look at the data you hand them, and handing them eight
# files one at a time is worse than handing them one.
echo "==> Zipping the CSVs"
rm -f "$out/apoc-csvs.zip"
# -j so the entries are bare file names rather than `scraped/income.csv`, and
# -X to leave out the extra file attributes, which nothing downstream reads.
zip -q -j -X "$out/apoc-csvs.zip" "$scraped"/*.csv

# The app shows the size before anyone commits to the download, and the
# manifest is where it looks up every other file's size. The zip is assembled
# here rather than in `convert`, so it gets recorded here too.
echo "==> Recording the zip in the manifest"
uv run python "$root/scripts/record_csv_zip.py" \
    "$out/data/manifest.json" "$out/apoc-csvs.zip"

# The caveats the "Ask an AI" button copies to the clipboard, as a file an agent
# that landed on the site can fetch for itself. Generated from the manifest
# above rather than written by hand, so a table APOC adds shows up on its own.
# A copy is committed at the repo root for review; see web/src/aiGuide.ts.
echo "==> Writing llms.txt"
abs_out="$(cd "$out" && pwd)"
(cd "$root/web" && npx --no-install tsx "$root/scripts/gen-llms-txt.ts" \
    "$abs_out/data/manifest.json" "$abs_out/llms.txt")

echo "==> Done: $out"
du -sh "$out"
