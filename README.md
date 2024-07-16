# apoc-data

Data from the [Alaska Public Offices Commission](https://aws.state.ak.us/ApocReports/Campaign/).

This scrapes the CSV files from the APOC website. This repo has a github action
which does this once a day and uploads to this repo's releases.
You can quickly download these CVSs with many clients such as curl
or pandas or ibis.

## dev install

```shell
pdm install
playwright install chromium
```

## scrape

```shell
python -m apoc_data.scrape --directory downloads --no-headless
```