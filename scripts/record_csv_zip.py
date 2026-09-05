"""Record the all-CSVs zip in the site's manifest.json.

The zip is assembled by `build_site.sh` out of the raw scrape, after `convert`
has already written the manifest, so it can't be described there. The app reads
its size from the manifest the same way it reads every other file's.

Usage: record_csv_zip.py <manifest.json> <apoc-csvs.zip>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main(argv: list[str]) -> None:
    if len(argv) != 2:
        raise SystemExit(__doc__)
    manifest_path, zip_path = (Path(arg) for arg in argv)
    manifest = json.loads(manifest_path.read_text())
    manifest["csv_zip"] = {
        "file": zip_path.name,
        "bytes": zip_path.stat().st_size,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"{zip_path} ({zip_path.stat().st_size} bytes) -> {manifest_path}")


if __name__ == "__main__":
    main(sys.argv[1:])
