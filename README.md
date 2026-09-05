# APOC Data

Alaska campaign financial disclosure data from the [Alaska Public Offices Commission](https://aws.state.ak.us/ApocReports/Campaign/).

This scrapes the CSV files from the APOC website once a day and uploads them to
[this repo's releases](https://github.com/NickCrews/apoc-data/releases).

---

## Explore It In Your Browser

**<https://nickcrews.github.io/apoc-data>**

Who gave money to which candidates, and what they spent it on — click to filter,
no SQL required. Pick a donor and every other chart, the totals, and the table of
matching records narrow to them; drag across the timeline to pick a date range;
flip between money in and money out.

It's a [SQLRooms](https://sqlrooms.org) app running
[DuckDB-WASM](https://duckdb.org/docs/stable/clients/wasm/overview.html): the
data is downloaded into your browser and queried there, so nothing you do is
sent anywhere. There's a SQL editor if you want one, and an "Ask an AI" panel
that hands you a copy-pasteable prompt (schema and data URLs included) for
questions the dashboard doesn't answer.

---

## Download a Recent Scrape

You can download the daily-scraped CSVs from the GitHub releases (this is what most users want).

### From the Web Interface

Browse from [this repo's releases](https://github.com/NickCrews/apoc-data/releases).
The latest release is also hosted on [the site](https://nickcrews.github.io/apoc-data),
as both CSV and parquet. Every file gets its own tab there, with its size and
row count, and the rows themselves: search them, or filter from the
distributions in the column headers — eg
[income](https://nickcrews.github.io/apoc-data#income).

Every CSV in one archive is at
<https://nickcrews.github.io/apoc-data/apoc-csvs.zip>. That's the one to grab
if you're feeding the data to ChatGPT or Gemini, which can't fetch a URL and
only see the files you attach to the chat.

### From the CLI

Using [uv](https://docs.astral.sh/uv/)'s `uvx`:

```shell
uvx apoc-data release download # downloads all files from the latest release to ./downloads/ folder
uvx apoc-data release download "20260702-125614" --destination mydownloads/ # specify explicitly
uvx apoc-data asset download debt.csv --destination apoc_debt.csv # download a single file
uvx apoc-data release list # see what releases are available
uvx apoc-data asset list --json # see what files are in the latest release, as JSON
```

Or, you can download these CSVs directly using the direct URLs from the releases page
using curl, pandas, ibis, whatever!

```bash
curl -L https://github.com/NickCrews/apoc-data/releases/latest/download/candidate_registration.csv > candidate_registration.csv # get latest
curl -L https://github.com/NickCrews/apoc-data/releases/download/20240716-025636/candidate_registration.csv > candidate_registration.csv # or a different url pattern for specific releases

# query directly using duckdb
duckdb -c "SELECT count(*) FROM 'https://github.com/NickCrews/apoc-data/releases/latest/download/candidate_registration.csv'"
duckdb -c "SELECT count(*) FROM 'https://github.com/NickCrews/apoc-data/releases/download/20240716-025636/candidate_registration.csv'"
```

### Parquet (typed, and much smaller)

The same data is also published as parquet on the GitHub Pages site, with the
strings parsed into real types: `"$1,234.00"` becomes a `DECIMAL(18,2)`,
`"7/16/2024"` becomes a `DATE`, and `income.csv` goes from 369MB to about 23MB.
DuckDB reads them straight over HTTPS, and only fetches the columns and row
groups your query touches:

```bash
duckdb -c "SELECT filer_name, sum(amount) AS raised
           FROM 'https://nickcrews.github.io/apoc-data/data/income.parquet'
           WHERE report_year = 2024
           GROUP BY 1 ORDER BY raised DESC LIMIT 10"
```

[`data/manifest.json`](https://nickcrews.github.io/apoc-data/data/manifest.json)
lists every table with its row count, columns and types, and date range.

Note that the GitHub release URLs above don't send CORS headers, so they can't be
fetched directly from a browser (eg from duckdb-wasm or a web app). That's why
the latest release is also mirrored to GitHub Pages, which *does* allow
cross-origin requests — it's what makes the in-browser explorer possible.
eg at https://shell.duckdb.org/:

- this works:    `SELECT count(*) FROM 'https://nickcrews.github.io/apoc-data/campaign_form.csv'`
- this does not: `SELECT count(*) FROM 'https://github.com/NickCrews/apoc-data/releases/latest/download/campaign_form.csv'`

### From python

We provide a python API too. `uv add apoc-data` and then

```python
from apoc_data.releases import asset_download, release_download, release_list

release_list()  # all releases, newest first, as `Release` objects
release_download(destination="downloads/")  # all files from the latest release
asset_download("debt.csv", destination="apoc_debt.csv")  # a single file
```

---

## Scrape Yourself

You can also scrape fresh data directly from the APOC website
(requires the `scrape` extra for playwright):

```shell
uvx "apoc-data[scrape]" scrape --directory scraped/
```

There is also a python API. Read the source code.

---

## License

MIT, do as you wish with the data and code!

## Dev Notes

Create venv and install dev deps:

```shell
uv sync
```

scrape:

```shell
uv run apoc-data scrape --directory downloads --no-headless
```

convert the scraped CSVs to typed parquet (plus a `manifest.json` describing
them):

```shell
uv run apoc-data convert --source scraped/ --destination _site/data/
```

The type of each column is detected rather than hardcoded, so new or renamed
APOC columns keep working. See `src/apoc_data/convert/`.

### The web app

The explorer lives in [`web/`](web/) — Vite + React +
[SQLRooms](https://sqlrooms.org) over DuckDB-WASM.

```shell
cd web
npm install
npm run data   # convert ../scraped into web/public/data (once)
npm run dev
```

Without local data, point it at the live site instead:

```shell
VITE_DATA_BASE_URL=https://nickcrews.github.io/apoc-data/data/ npm run dev
```

### The Pages site

`scripts/build_site.sh` assembles everything that gets published, so the layout
is reproducible outside CI:

```shell
scripts/build_site.sh scraped _site
```

```
_site/
  index.html, assets/   the explorer app, which lists every file below
  data/*.parquet        typed parquet + manifest.json
  *.csv, *.csv.zip      the raw scrape, at the URLs it has always had
  apoc-csvs.zip         every CSV in one file, to upload somewhere
```