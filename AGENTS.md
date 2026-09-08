# AGENTS.md

Alaska campaign finance data, scraped daily from the Alaska Public Offices
Commission and republished as typed Parquet, raw CSV, and a browser dashboard.

## If you're here to analyze the data, not change this repo

Read **[llms.txt](llms.txt)** — the schema, the URLs, and, more importantly, the
half-dozen ways this data will hand you a confident wrong answer if you query it
naively. Published at <https://nickcrews.github.io/apoc-data/llms.txt>.

Short version: the Parquet is queryable over HTTPS, so you don't need to
download anything.

```bash
duckdb -c "SELECT filer_name, sum(amount) AS raised
           FROM 'https://nickcrews.github.io/apoc-data/data/income.parquet'
           WHERE report_year = 2024
           GROUP BY 1 ORDER BY raised DESC LIMIT 10"
```

## If you're here to change the repo

`README.md` has the full tour. The parts that aren't obvious from the tree:

| Path | What it is |
| --- | --- |
| `src/apoc_data/` | the Python package: scraper, CSV→Parquet converter, release client, CLI |
| `web/` | the explorer app — Vite + React + [SQLRooms](https://sqlrooms.org) over DuckDB-WASM |
| `scripts/build_site.sh` | assembles everything published to GitHub Pages; run it to reproduce CI locally |
| `llms.txt` | generated — see below |

```shell
uv sync                                             # Python dev deps
uv run apoc-data scrape --directory scraped         # fresh scrape (needs the `scrape` extra)
uv run apoc-data convert --source scraped --destination _site/data
cd web && npm install && npm run dev                # the app, against web/public/data
scripts/build_site.sh scraped _site                 # the whole published site
```

Column types are detected rather than hardcoded, so a new or renamed APOC column
keeps working. Don't add a hardcoded schema.

## Editing what AIs are told about this data

`llms.txt` and the "Ask an AI" prompt in the dashboard are two renderings of one
source: [`web/src/aiGuide.ts`](web/src/aiGuide.ts). Edit the caveats or the
framing there, never in `llms.txt` itself, then regenerate and commit both:

```shell
cd web && npx tsx ../scripts/gen-llms-txt.ts
```

`scripts/build_site.sh` regenerates the served copy from the freshly scraped
manifest, so the committed one only needs refreshing when you change the prose.
It carries no row counts or timestamps, which is what keeps its diffs readable.
