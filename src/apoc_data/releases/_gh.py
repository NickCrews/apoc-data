"""Download CSV(s) of APOC data from https://github.com/NickCrews/apoc-data/releases."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
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
            available = ", ".join(sorted(assets)) or "<no files>"
            raise ValueError(
                f"Release {release} does not have a file named {filename}. "
                f"Available files: {available}"
            )
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
    try:
        info = json.loads(_get(url))
    except HTTPError as e:
        if e.code == 404:
            requested = release if release is not None else tag
            raise ValueError(
                f"No release found for {requested!r}. "
                f"Available releases: {_available_releases_hint()}"
            ) from e
        raise
    assets = {asset["name"]: asset["browser_download_url"] for asset in info["assets"]}
    return info["tag_name"], assets


def _available_releases_hint() -> str:
    try:
        tags = [r["tag_name"] for r in get_releases()]
    except Exception:
        return "<unable to fetch releases>"
    return ", ".join(["latest", *tags]) or "<no releases>"


def _download_asset(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with open(destination, "wb") as file:
        file.write(_get(url))


def _get(url: str) -> bytes:
    # I'm getting hit by rate limits when using streamlit cloud, I assume because
    # the IP address is shared. So I'm trying to use a personal access token to
    # authenticate.
    headers = {"Accept": "application/vnd.github.v3+json"}
    try:
        pat = os.environ["GITHUB_PAT"]
        headers["Authorization"] = f"token {pat}"
    except KeyError:
        pass
    with urlopen(Request(url, headers=headers)) as response:
        return response.read()
