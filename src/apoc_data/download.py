"""Download CSV(s) of APOC data from https://github.com/NickCrews/apoc-data/releases

A no-install way to use this script is to download it from github and pipe to curl:

```shell
curl -s https://raw.githubusercontent.com/NickCrews/apoc-data/main/src/apoc_data/download.py | python - --release latest
```
"""

import argparse
import json
from pathlib import Path
from urllib.request import urlopen


def download(
    *,
    release: str = "latest",
    filename: str | None = None,
    destination: str | Path = "downloads/",
) -> None:
    """Download CSV(s) of APOC data from https://github.com/NickCrews/apoc-data/releases.

    Parameters
    ----------
    release : str, optional
        The name of the release to download.
        Default is None, which means latest release
    filename : str, optional
        The name of the file to download.
        Default is None, which downloads all files.
    destination : str or Path, optional
        Where to save the file(s).
        If this looks like a file (the final path segment contains a `.`),
        then we can only download a single file, and it will be saved to that location.
        Otherwise, the file(s) will be saved underneath there.
    """
    destination = Path(destination)
    release, assets = _get_release_info(release)
    if filename is not None:
        if filename not in assets:
            raise ValueError(f"Release {release} does not have a file named {filename}")
        if not _is_file(destination):
            destination = destination / filename
        _download_asset(assets[filename], destination)
    else:
        if _is_file(destination):
            raise ValueError("Can't download all files to a single file")
        for name, url in assets.items():
            _download_asset(url, destination / name)


def _is_file(destination: Path) -> bool:
    return "." in destination.name


def _get_release_info(release: str) -> tuple[str, dict[str, str]]:
    url = f"https://api.github.com/repos/NickCrews/apoc-data/releases/{release}"
    with urlopen(url) as response:
        info = json.loads(response.read())
    assets = {asset["name"]: asset["browser_download_url"] for asset in info["assets"]}
    return info["tag_name"], assets


def _download_asset(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(url) as response, open(destination, "wb") as file:
        file.write(response.read())


def cli():
    parser = argparse.ArgumentParser(
        description="Download data from the Alaska Public Offices Commission"
    )
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
    args = parser.parse_args()
    download(release=args.release, filename=args.filename, destination=args.destination)


if __name__ == "__main__":
    cli()
