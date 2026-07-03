"""Access the APOC data published at https://github.com/NickCrews/apoc-data/releases."""

from __future__ import annotations

import dataclasses
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

_REPO = "NickCrews/apoc-data"
_API_ROOT = f"https://api.github.com/repos/{_REPO}"


@dataclasses.dataclass(frozen=True)
class Asset:
    """A single downloadable file in a release."""

    name: str
    """The filename, e.g. ``candidate_registration.csv``."""
    url: str
    """The direct download URL."""
    size: int
    """The size in bytes."""
    updated_at: datetime
    """When the asset was last updated."""

    @classmethod
    def _from_api(cls, raw: dict[str, Any]) -> Asset:
        return cls(
            name=raw["name"],
            url=raw["browser_download_url"],
            size=raw["size"],
            updated_at=_parse_timestamp(raw["updated_at"]),
        )

    def to_dict(self) -> dict[str, Any]:
        """Convert to a JSON-serializable dict."""
        return {
            "name": self.name,
            "url": self.url,
            "size": self.size,
            "updated_at": self.updated_at.isoformat(),
        }

    def download(self, destination: str | Path) -> Path:
        """Download this asset to the given file path and return it."""
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(_get(self.url))
        return destination


@dataclasses.dataclass(frozen=True)
class Release:
    """A release of the APOC data on GitHub."""

    tag: str
    """The git tag, e.g. ``20240716-025636``."""
    name: str
    """The human-readable release title."""
    url: str
    """The web page for the release."""
    published_at: datetime
    """When the release was published."""
    assets: tuple[Asset, ...]
    """The downloadable files in this release."""

    @classmethod
    def _from_api(cls, raw: dict[str, Any]) -> Release:
        return cls(
            tag=raw["tag_name"],
            name=raw["name"] or raw["tag_name"],
            url=raw["html_url"],
            published_at=_parse_timestamp(raw["published_at"]),
            assets=tuple(Asset._from_api(a) for a in raw["assets"]),
        )

    def to_dict(self) -> dict[str, Any]:
        """Convert to a JSON-serializable dict."""
        return {
            "tag": self.tag,
            "name": self.name,
            "url": self.url,
            "published_at": self.published_at.isoformat(),
            "assets": [a.to_dict() for a in self.assets],
        }

    def asset(self, filename: str) -> Asset:
        """Get the asset with the given filename, or raise ValueError."""
        for asset in self.assets:
            if asset.name == filename:
                return asset
        available = ", ".join(sorted(a.name for a in self.assets)) or "<no files>"
        raise ValueError(
            f"Release {self.tag} does not have a file named {filename}. "
            f"Available files: {available}"
        )


def release_list() -> list[Release]:
    """List all releases of the APOC data, newest first."""
    raw = json.loads(_get(f"{_API_ROOT}/releases"))
    return [Release._from_api(r) for r in raw]


def release_get(release: str = "latest") -> Release:
    """Get a single release by tag, or the latest release.

    Parameters
    ----------
    release :
        A tag such as ``20240716-025636``, or ``latest`` for the most recent release.
    """
    if release == "latest":
        url = f"{_API_ROOT}/releases/latest"
    else:
        url = f"{_API_ROOT}/releases/tags/{release}"
    try:
        raw = json.loads(_get(url))
    except HTTPError as e:
        if e.code == 404:
            raise ValueError(
                f"No release found for {release!r}. "
                f"Available releases: {_available_releases_hint()}"
            ) from e
        raise
    return Release._from_api(raw)


def asset_list(release: str = "latest") -> list[Asset]:
    """List the downloadable files in a release.

    Parameters
    ----------
    release :
        A tag such as ``20240716-025636``, or ``latest`` for the most recent release.
    """
    return list(release_get(release).assets)


def release_download(
    release: str = "latest",
    *,
    destination: str | Path = "downloads/",
) -> list[Path]:
    """Download all files in a release to a folder and return the downloaded paths.

    Parameters
    ----------
    release :
        A tag such as ``20240716-025636``, or ``latest`` for the most recent release.
    destination :
        The folder to save the files under.
    """
    destination = Path(destination)
    rel = release_get(release)
    return [asset.download(destination / asset.name) for asset in rel.assets]


def asset_download(
    filename: str,
    *,
    release: str = "latest",
    destination: str | Path | None = None,
) -> Path:
    """Download a single file from a release and return the downloaded path.

    Parameters
    ----------
    filename :
        The name of the file to download, e.g. ``debt.csv``.
    release :
        A tag such as ``20240716-025636``, or ``latest`` for the most recent release.
    destination :
        The file path to save to.
        Default is None, which saves to ``filename`` in the current directory.
    """
    asset = release_get(release).asset(filename)
    if destination is None:
        destination = Path(asset.name)
    return asset.download(destination)


def _available_releases_hint() -> str:
    try:
        tags = [r.tag for r in release_list()]
    except Exception:
        return "<unable to fetch releases>"
    return ", ".join(["latest", *tags]) or "<no releases>"


def _parse_timestamp(raw: str) -> datetime:
    # GitHub timestamps look like "2024-07-16T02:56:36Z".
    # datetime.fromisoformat can't parse the trailing "Z" until python 3.11.
    return datetime.strptime(raw, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


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
