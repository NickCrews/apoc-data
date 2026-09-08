"""Single CLI entry point for apoc-data.

Subcommands:

- ``release list|get|download``: inspect the available releases and download
  all files in one (what most end users want; no extra dependencies).
- ``asset list|download``: inspect and fetch individual files within a release.
- ``scrape``: scrape the data from the APOC website using playwright
  (requires installing the ``scrape`` extra, e.g. ``apoc-data[scrape]``).
- ``convert``: convert the scraped CSVs to typed parquet files
  (requires installing the ``convert`` extra, e.g. ``apoc-data[convert]``).

Usage:

```shell
uvx apoc-data release download
uvx apoc-data release list --json
uvx apoc-data asset list --release 20240716-025636
uvx apoc-data asset download debt.csv --destination apoc_debt.csv
uvx "apoc-data[scrape]" scrape --directory scraped/
uvx "apoc-data[convert]" convert --source scraped/ --destination _site/data/
```
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from apoc_data.convert import DEFAULT_DESTINATION, DEFAULT_SOURCE
from apoc_data.releases import (
    Asset,
    Release,
    asset_download,
    asset_list,
    release_download,
    release_get,
    release_list,
)


def _configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def _add_json_flag(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output JSON instead of human-readable text",
    )


def _add_release_flag(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--release",
        type=str,
        default="latest",
        help='A release tag, or "latest" (the default)',
    )


def _human_size(size: int) -> str:
    n = float(size)
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    raise AssertionError("unreachable")


def _print_release(release: Release) -> None:
    print(f"tag:          {release.tag}")
    print(f"name:         {release.name}")
    print(f"url:          {release.url}")
    print(f"published_at: {release.published_at.isoformat()}")
    print("assets:")
    for asset in release.assets:
        print(f"  {asset.name} ({_human_size(asset.size)})")


def _print_assets(assets: list[Asset]) -> None:
    if not assets:
        print("<no files>")
        return
    width = max(len(a.name) for a in assets)
    for asset in assets:
        print(f"{asset.name:<{width}}  {_human_size(asset.size):>9}  {asset.url}")


def _run_release_list(args: argparse.Namespace) -> None:
    releases = release_list()
    if args.json:
        print(json.dumps([r.to_dict() for r in releases], indent=2))
        return
    for release in releases:
        n_assets = len(release.assets)
        print(f"{release.tag}  {release.published_at.isoformat()}  {n_assets} assets")


def _run_release_get(args: argparse.Namespace) -> None:
    release = release_get(args.release)
    if args.json:
        print(json.dumps(release.to_dict(), indent=2))
    else:
        _print_release(release)


def _run_asset_list(args: argparse.Namespace) -> None:
    assets = asset_list(args.release)
    if args.json:
        print(json.dumps([a.to_dict() for a in assets], indent=2))
    else:
        _print_assets(assets)


def _run_release_download(args: argparse.Namespace) -> None:
    paths = release_download(args.release, destination=args.destination)
    if args.json:
        print(json.dumps([str(p) for p in paths], indent=2))
    else:
        for path in paths:
            print(path)


def _run_asset_download(args: argparse.Namespace) -> None:
    path = asset_download(
        args.filename, release=args.release, destination=args.destination
    )
    if args.json:
        print(json.dumps(str(path)))
    else:
        print(path)


def _run_scrape(args: argparse.Namespace) -> None:
    try:
        from apoc_data.scrape import scrape_all
        from apoc_data.scrape._scraper import (
            DEFAULT_ATTEMPTS,
            DEFAULT_DIRECTORY,
            DEFAULT_RETRY_BACKOFF,
        )
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
    trace_dir = Path(args.trace_dir).absolute() if args.trace_dir else None
    _configure_logging()
    scrape_all(
        directory,
        headless=args.headless,
        attempts=DEFAULT_ATTEMPTS if args.attempts is None else args.attempts,
        retry_backoff=(
            DEFAULT_RETRY_BACKOFF if args.retry_backoff is None else args.retry_backoff
        ),
        trace_dir=trace_dir,
    )


def _run_convert(args: argparse.Namespace) -> None:
    from apoc_data.convert import convert_all

    _configure_logging()
    paths = convert_all(source=args.source, destination=args.destination)
    if args.json:
        print(json.dumps([str(p) for p in paths], indent=2))
    else:
        for path in paths:
            print(f"{path} ({_human_size(path.stat().st_size)})")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="apoc-data",
        description="Data from the Alaska Public Offices Commission",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    release_parser = subparsers.add_parser(
        "release",
        help="Inspect the available releases",
    )
    release_subparsers = release_parser.add_subparsers(
        dest="release_command", required=True
    )

    release_list_parser = release_subparsers.add_parser(
        "list",
        help="List all releases, newest first",
    )
    _add_json_flag(release_list_parser)
    release_list_parser.set_defaults(func=_run_release_list)

    release_get_parser = release_subparsers.add_parser(
        "get",
        help="Show a single release",
    )
    release_get_parser.add_argument(
        "release",
        nargs="?",
        default="latest",
        help='A release tag, or "latest" (the default)',
    )
    _add_json_flag(release_get_parser)
    release_get_parser.set_defaults(func=_run_release_get)

    release_download_parser = release_subparsers.add_parser(
        "download",
        help="Download all files in a release to a folder",
        description="Download all CSVs of APOC data from "
        "https://github.com/NickCrews/apoc-data/releases",
    )
    release_download_parser.add_argument(
        "release",
        nargs="?",
        default="latest",
        help='A release tag, or "latest" (the default)',
    )
    release_download_parser.add_argument(
        "--destination",
        type=str,
        default="downloads/",
        help="The folder to save the files under (default: downloads/)",
    )
    _add_json_flag(release_download_parser)
    release_download_parser.set_defaults(func=_run_release_download)

    asset_parser = subparsers.add_parser(
        "asset",
        help="Inspect and download the files within a release",
    )
    asset_subparsers = asset_parser.add_subparsers(dest="asset_command", required=True)

    asset_list_parser = asset_subparsers.add_parser(
        "list",
        help="List the files in a release",
    )
    _add_release_flag(asset_list_parser)
    _add_json_flag(asset_list_parser)
    asset_list_parser.set_defaults(func=_run_asset_list)

    asset_download_parser = asset_subparsers.add_parser(
        "download",
        help="Download file(s) from a release",
    )
    asset_download_parser.add_argument(
        "filename",
        help="The name of the file to download, e.g. debt.csv",
    )
    _add_release_flag(asset_download_parser)
    asset_download_parser.add_argument(
        "--destination",
        type=str,
        default=None,
        help="The file path to save to (default: the filename in the current directory)",
    )
    _add_json_flag(asset_download_parser)
    asset_download_parser.set_defaults(func=_run_asset_download)

    scrape_parser = subparsers.add_parser(
        "scrape",
        help='Scrape the data from the APOC website (requires the "scrape" extra)',
        description="Scrape .CSVs from https://aws.state.ak.us/ApocReports/Campaign/",
    )
    scrape_parser.add_argument(
        "--directory",
        type=str,
        default=None,
        help="The directory to save the data to (default: scraped/)",
    )
    scrape_parser.add_argument(
        "--headless",
        default=True,
        action=argparse.BooleanOptionalAction,
        help="Run the browser in headless mode",
    )
    scrape_parser.add_argument(
        "--attempts",
        type=int,
        default=None,
        help=(
            "How many times to try each individual scrape before giving up. "
            "The APOC server is intermittently slow (default: 4)"
        ),
    )
    scrape_parser.add_argument(
        "--retry-backoff",
        type=float,
        default=None,
        help="Base seconds for exponential backoff between retries (default: 5)",
    )
    scrape_parser.add_argument(
        "--trace-dir",
        type=str,
        default=None,
        help=(
            "Save a Playwright trace for each failed attempt to this directory. "
            "View one with `playwright show-trace <file>` to see the DOM, "
            "screenshots and network activity at the moment of failure"
        ),
    )
    scrape_parser.set_defaults(func=_run_scrape)

    convert_parser = subparsers.add_parser(
        "convert",
        help='Convert the scraped CSVs to typed parquet (requires the "convert" extra)',
        description="Convert the untyped APOC CSVs into typed, much smaller parquet files",
    )
    convert_parser.add_argument(
        "--source",
        type=str,
        default=DEFAULT_SOURCE,
        help=f"The directory of CSVs to convert (default: {DEFAULT_SOURCE})",
    )
    convert_parser.add_argument(
        "--destination",
        type=str,
        default=DEFAULT_DESTINATION,
        help=f"The directory to write parquet files to (default: {DEFAULT_DESTINATION})",
    )
    _add_json_flag(convert_parser)
    convert_parser.set_defaults(func=_run_convert)

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
