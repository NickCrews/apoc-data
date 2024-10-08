"""Download CSV(s) of APOC data from https://github.com/NickCrews/apoc-data/releases

A no-install way to use this script is to download it from github and pipe to curl:

```shell
curl -s https://raw.githubusercontent.com/NickCrews/apoc-data/main/src/apoc_data/download.py | python - --release latest
```
"""

import argparse
import json
import os
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen


def download(
    *,
    release: str | None = None,
    tag: str | None = None,
    filename: str | None = None,
    destination: str | Path = "downloads/",
) -> None:
    """Download CSV(s) of APOC data from https://github.com/NickCrews/apoc-data/releases.

    Parameters
    ----------
    release :
        The name of the release to download.
        Default is None, which means latest release.
        You can also provide a tag instead of a release.
    tag :
        The name of the release to download.
        Default is None, which means latest release.
        You can also provide a release instead of a tag.
    filename :
        The name of the file to download.
        Default is None, which downloads all files.
    destination :
        Where to save the file(s).
        If this looks like a file (the final path segment contains a `.`),
        then we can only download a single file, and it will be saved to that location.
        Otherwise, the file(s) will be saved underneath there.
    """
    if release is not None and tag is not None:
        raise ValueError("Can't provide both release and tag")
    if release is None and tag is None:
        release = "latest"

    destination = Path(destination)
    release, assets = _get_release_info(release=release, tag=tag)
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


def get_releases() -> list[dict[str, Any]]:
    """Get information about all releases of the APOC data."""
    url = "https://api.github.com/repos/NickCrews/apoc-data/releases"
    return json.loads(_get(url))


def _is_file(destination: Path) -> bool:
    return "." in destination.name


def _get_release_info(
    *, release: str | None = None, tag: str | None = None
) -> tuple[str, dict[str, str]]:
    if release is not None:
        url = f"https://api.github.com/repos/NickCrews/apoc-data/releases/{release}"
    else:
        url = f"https://api.github.com/repos/NickCrews/apoc-data/releases/tags/{tag}"
    info = json.loads(_get(url))
    assets = {asset["name"]: asset["browser_download_url"] for asset in info["assets"]}
    return info["tag_name"], assets


def _download_asset(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with open(destination, "wb") as file:
        file.write(_get(url))


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


def _get(url: str) -> str:
    # I'm getting hit by rate limits when using streamlit cloud, I assume because
    # the IP address is shared. So I'm trying to use a personal access token to
    # authenticate.
    headers = {"Accept": "application/vnd.github.v3+json"}
    try:
        pat = os.environ["GITHUB_PAT"]
        headers["Authorization"] = f"toasdasken {pat}"
    except KeyError:
        pass
    with urlopen(Request(url, headers=headers)) as response:
        return response.read()


if __name__ == "__main__":
    cli()
