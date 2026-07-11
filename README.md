# APOC Data

Alaska campaign financial disclosure data from the [Alaska Public Offices Commission](https://aws.state.ak.us/ApocReports/Campaign/).

This scrapes the CSV files from the APOC website once a day and uploads them to
[this repo's releases](https://github.com/NickCrews/apoc-data/releases).

---

## Download a Recent Scrape

You can download the daily-scraped CSVs from the GitHub releases (this is what most users want).

### From the Web Interface

Browse from [this repo's releases](https://github.com/NickCrews/apoc-data/releases).
Or the latest release is also hosted at https://nickcrews.github.io/apoc-data.

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

Note that the GitHub release URLs above don't send CORS headers, so they can't be
fetched directly from a browser (eg from duckdb-wasm or a web app). For that use case,
the latest release is also mirrored to GitHub Pages, which *does* allow cross-origin
requests. eg at https://shell.duckdb.org/:

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