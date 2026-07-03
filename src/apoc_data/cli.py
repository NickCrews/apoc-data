"""Single CLI entry point for apoc-data.

Exposes two subcommands:

- ``download``: fetch prebuilt CSVs from the GitHub releases
  (what most end users want; no extra dependencies).
- ``scrape``: scrape the data from the APOC website using playwright
  (requires installing the ``scrape`` extra, e.g. ``apoc-data[scrape]``).

Usage:

```shell
uvx apoc-data download --release latest
uvx "apoc-data[scrape]" scrape --directory scraped/
```
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

from apoc_data.releases import download


def _add_download_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--release",
        type=str,
        default="latest",
        help="The name of the release to download",
    )
    parser.add_argument(
        "--filename",
        type=str,
        help="The name of the file to download",
    )
    parser.add_argument(
        "--destination",
        type=str,
        default="downloads/",
        help="Where to save the file(s)",
    )


def _add_scrape_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--directory",
        type=str,
        default=None,
        help="The directory to save the data to (default: scraped/)",
    )
    parser.add_argument(
        "--headless",
        default=True,
        action=argparse.BooleanOptionalAction,
        help="Run the browser in headless mode",
    )


def _run_scrape(args: argparse.Namespace) -> None:
    try:
        from apoc_data.scrape import scrape_all
        from apoc_data.scrape._scraper import DEFAULT_DIRECTORY
    except ImportError as e:
        raise SystemExit(
            "The scrape command requires extra dependencies. "
            'Install them with the "scrape" extra, e.g. '
            '`pip install "apoc-data[scrape]"` or `uvx "apoc-data[scrape]" scrape`.'
            f"\n(import failed: {e})"
        ) from e

    directory = Path(args.directory or DEFAULT_DIRECTORY).absolute()
    if directory.is_file():
        raise ValueError("The directory can't be a file")
    logging.basicConfig(level=logging.INFO)
    scrape_all(directory, headless=args.headless)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="apoc-data",
        description="Data from the Alaska Public Offices Commission",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    download_parser = subparsers.add_parser(
        "download",
        help="Download prebuilt CSVs from the GitHub releases",
        description="Download CSV(s) of APOC data from "
        "https://github.com/NickCrews/apoc-data/releases",
    )
    _add_download_args(download_parser)

    def _run_download(args: argparse.Namespace) -> None:
        download(
            release=args.release, filename=args.filename, destination=args.destination
        )

    download_parser.set_defaults(func=_run_download)

    scrape_parser = subparsers.add_parser(
        "scrape",
        help='Scrape the data from the APOC website (requires the "scrape" extra)',
        description="Scrape .CSVs from https://aws.state.ak.us/ApocReports/Campaign/",
    )
    _add_scrape_args(scrape_parser)
    scrape_parser.set_defaults(func=_run_scrape)

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
