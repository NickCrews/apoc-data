# APOC Data

Data from the [Alaska Public Offices Commission](https://aws.state.ak.us/ApocReports/Campaign/).

This scrapes the CSV files from the APOC website once a day and uploads them to
[this repo's releases](https://github.com/NickCrews/apoc-data/releases).

## Manual

Browse from [this repo's releases](https://github.com/NickCrews/apoc-data/releases).

## Python

`pip install apoc-data` and then

```python
from apoc_data.download import download

download(
    release="latest",
    filename="debt.csv",
    destination="apoc_debt.csv",
)
```

## Shell

You can download these CSVs using the direct URLs from the releases page
using curl, pandas, ibis, whatever!

```bash
curl -L https://github.com/NickCrews/apoc-data/releases/download/20240716-025636/candidate_registration.csv > candidate_registration.csv
```

or we have a tiny python script that makes this a little nicer, eg get the latest
release, choose the download directory, etc. Read the script for more info.

```bash
curl -s https://raw.githubusercontent.com/NickCrews/apoc-data/main/src/apoc_data/download.py | python - --release latest
```

## Dev Notes

```shell
pdm install
playwright install chromium
```

scrape:

```shell
python -m apoc_data.scrape --directory downloads --no-headless
```