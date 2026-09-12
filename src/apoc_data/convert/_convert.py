"""Convert the scraped APOC CSVs into typed parquet files.

The CSVs from APOC are entirely untyped: money looks like ``"$1,234.56"``
(or ``"($1,234.56)"`` when negative), dates look like ``"7/16/2024"``, and
``income.csv`` is 369MB, which is far too big to pull into a browser.

Converting to parquet fixes both problems at once: the same data is ~15x
smaller, and it arrives with real ``DATE`` and ``DECIMAL`` columns, so it is
usable from duckdb-wasm (see ``web/``), pandas, or anything else without every
consumer reinventing the same string munging.

The types are *detected*, not hardcoded per table, so this keeps working when
APOC adds or renames a column. Every cast is a ``TRY_CAST``, so a single
malformed value becomes NULL instead of failing the whole conversion.
"""

from __future__ import annotations

import dataclasses
import json
import logging
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Iterable

if TYPE_CHECKING:
    import duckdb

_logger = logging.getLogger(__name__)

DEFAULT_SOURCE = "scraped/"
DEFAULT_DESTINATION = "_site/data/"

# Saved next to the CSVs by whoever downloaded them from a GitHub release; see
# `_read_release`.
RELEASE_FILE = "release.json"

# APOC puts a literal `--------` column in some exports to separate the
# transaction's own fields from the fields describing the filer who reported it.
_SEPARATOR_RE = re.compile(r"^-+$")

# Columns that are digits but are identifiers, not quantities. Zip codes lose
# their leading zeros as ints, and check numbers/phone numbers aren't numbers
# you'd ever do math on.
_NEVER_NUMERIC = frozenset({"zip", "phone", "fax", "payment_detail"})

# The widest all-digit value we're willing to call an INTEGER. 9 digits always
# fits in an int32; 10 wouldn't, and a bare 10-digit number is a phone number
# anyway.
_MAX_INT_DIGITS = 9

# APOC writes dates as M/D/YYYY, with no zero padding.
_DATE_FORMAT = "%-m/%-d/%Y"


@dataclasses.dataclass(frozen=True)
class ColumnSpec:
    """How one CSV column becomes one parquet column."""

    source: str
    """The column name as it appears in the CSV (deduplicated by duckdb)."""
    name: str
    """The snake_case name to give it in the parquet file."""
    type: str
    """One of VARCHAR, DATE, DECIMAL(18,2), INTEGER."""

    def to_sql(self) -> str:
        src = _quote_ident(self.source)
        if self.type == "DATE":
            expr = f"TRY_CAST(TRY_STRPTIME({src}, '{_DATE_FORMAT}') AS DATE)"
        elif self.type.startswith("DECIMAL"):
            expr = f"{_money_sign_sql(src)} * TRY_CAST({_money_digits_sql(src)} AS {self.type})"
        elif self.type == "INTEGER":
            expr = f"TRY_CAST({src} AS INTEGER)"
        else:
            # Empty strings are much less useful than NULLs to query against.
            expr = f"NULLIF(TRIM({src}), '')"
        return f"{expr} AS {_quote_ident(self.name)}"

    def to_dict(self) -> dict:
        return {"name": self.name, "type": self.type, "source": self.source}


@dataclasses.dataclass(frozen=True)
class TableSpec:
    """How one CSV file becomes one parquet file."""

    name: str
    """The table name, eg ``income`` for ``income.csv``."""
    source_path: Path
    columns: tuple[ColumnSpec, ...]

    def to_sql(self) -> str:
        selects = ",\n    ".join(c.to_sql() for c in self.columns)
        return f"SELECT\n    {selects}\nFROM {_read_csv_sql(self.source_path)}"


def _quote_ident(name: str) -> str:
    escaped = name.replace('"', '""')
    return f'"{escaped}"'


def _quote_str(value: str) -> str:
    escaped = value.replace("'", "''")
    return f"'{escaped}'"


def _read_csv_sql(path: Path) -> str:
    # all_varchar because we do all the typing ourselves below, and because
    # duckdb's own sniffing gets confused by the money and date formats.
    return f"read_csv({_quote_str(str(path))}, all_varchar=true)"


def _money_digits_sql(src: str) -> str:
    """SQL stripping ``$``, ``,``, ``(`` and ``)`` from a money string."""
    expr = src
    for char in ("$", ",", "(", ")"):
        expr = f"replace({expr}, {_quote_str(char)}, '')"
    return expr


def _money_sign_sql(src: str) -> str:
    """SQL for the sign of a money string: APOC parenthesizes negatives."""
    return f"CASE WHEN {src} LIKE '(%' THEN -1 ELSE 1 END"


def snake_case(name: str) -> str:
    """``"Last/Business Name"`` -> ``"last_business_name"``."""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def _column_names(con: duckdb.DuckDBPyConnection, path: Path) -> list[str]:
    rows = con.execute(f"DESCRIBE SELECT * FROM {_read_csv_sql(path)}").fetchall()
    return [row[0] for row in rows]


def _target_names(source_names: Iterable[str]) -> dict[str, str]:
    """Map CSV column names to parquet column names.

    Columns after the ``--------`` separator describe the filer who submitted
    the report, not the transaction. That's how ``debt.csv`` ends up with two
    ``Name`` columns (duckdb hands us the second one as ``Name_1``): the first
    is who was owed money, the second is who owes it.
    """
    result: dict[str, str] = {}
    past_separator = False
    for source in source_names:
        if _SEPARATOR_RE.match(source.strip()):
            past_separator = True
            continue
        name = snake_case(source)
        if past_separator and name in ("name", "name_1"):
            name = "filer_name"
        result[source] = name
    return result


def _detect_type(
    con: duckdb.DuckDBPyConnection, path: Path, source: str, name: str
) -> str:
    """Pick the narrowest type that every non-empty value in the column fits.

    Requiring *every* value to fit means a mostly-text column with a few
    numbers in it stays text, which is what you want.
    """
    src = _quote_ident(source)
    nonempty = f"NULLIF(TRIM({src}), '') IS NOT NULL"
    digits = f"regexp_full_match(TRIM({src}), '[0-9]+')"
    row = con.execute(f"""
        SELECT
            count(*) FILTER (WHERE {nonempty}) AS n,
            count(*) FILTER (
                WHERE {nonempty}
                AND ({src} LIKE '$%' OR {src} LIKE '($%')
                AND TRY_CAST({_money_digits_sql(src)} AS DECIMAL(18, 2)) IS NOT NULL
            ) AS n_money,
            count(*) FILTER (
                WHERE {nonempty} AND TRY_STRPTIME({src}, '{_DATE_FORMAT}') IS NOT NULL
            ) AS n_date,
            count(*) FILTER (
                WHERE {nonempty}
                AND {digits}
                AND length(TRIM({src})) <= {_MAX_INT_DIGITS}
                AND NOT starts_with(TRIM({src}), '0')
            ) AS n_int
        FROM {_read_csv_sql(path)}
    """).fetchone()
    assert row is not None
    n, n_money, n_date, n_int = row
    if not n:
        return "VARCHAR"
    if n_money == n:
        return "DECIMAL(18,2)"
    if n_date == n:
        return "DATE"
    if n_int == n and name not in _NEVER_NUMERIC:
        return "INTEGER"
    return "VARCHAR"


def table_spec(con: duckdb.DuckDBPyConnection, path: Path) -> TableSpec:
    """Inspect a CSV and decide how to convert it."""
    names = _target_names(_column_names(con, path))
    columns = tuple(
        ColumnSpec(source=source, name=name, type=_detect_type(con, path, source, name))
        for source, name in names.items()
    )
    return TableSpec(name=path.stem, source_path=path, columns=columns)


def convert_one(
    path: str | Path,
    *,
    destination: str | Path = DEFAULT_DESTINATION,
    con: duckdb.DuckDBPyConnection | None = None,
) -> Path:
    """Convert one CSV to a typed parquet file, returning the parquet path."""
    con = con if con is not None else _connect()
    path = Path(path)
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    out = destination / f"{path.stem}.parquet"

    spec = table_spec(con, path)
    _logger.info("Converting %s -> %s (%d columns)", path, out, len(spec.columns))
    con.execute(f"""
        COPY ({spec.to_sql()})
        TO {_quote_str(str(out))}
        -- Smallish row groups so duckdb-wasm can range-read a slice of the
        -- file instead of the whole thing.
        (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)
    """)
    return out


def convert_all(
    source: str | Path = DEFAULT_SOURCE,
    destination: str | Path = DEFAULT_DESTINATION,
) -> list[Path]:
    """Convert every CSV in ``source`` to parquet in ``destination``.

    Also writes a ``manifest.json`` describing the results, which the web app
    uses to show schemas and row counts without querying anything. If the CSVs
    came from a GitHub release and a ``release.json`` beside them says which,
    the manifest records that too: it is what dates the data.
    """
    source = Path(source)
    destination = Path(destination)
    csvs = sorted(source.glob("*.csv"))
    if not csvs:
        raise ValueError(f"No CSVs found in {source}")
    con = _connect()
    paths = [convert_one(csv, destination=destination, con=con) for csv in csvs]
    write_manifest(destination, csvs=csvs, con=con, release=_read_release(source))
    return paths


def write_manifest(
    destination: str | Path,
    *,
    csvs: Iterable[Path] = (),
    con: duckdb.DuckDBPyConnection | None = None,
    release: dict | None = None,
) -> Path:
    """Describe every parquet file in ``destination`` in a ``manifest.json``.

    ``release`` is the GitHub release the CSVs were downloaded from, if any, as
    returned by ``_read_release``. Its ``published_at`` is when that scrape
    finished, which is the date the web app shows readers. ``generated_at`` is
    only when this ran, which for a local scrape is the best there is.
    """
    con = con if con is not None else _connect()
    destination = Path(destination)
    csv_paths = {p.stem: p for p in csvs}
    now = datetime.now(timezone.utc)
    tables = [
        _describe_table(con, parquet, csv=csv_paths.get(parquet.stem), today=now.date())
        for parquet in sorted(destination.glob("*.parquet"))
    ]
    manifest = {
        "generated_at": now.isoformat(timespec="seconds"),
        "release": release,
        "tables": tables,
    }
    out = destination / "manifest.json"
    out.write_text(json.dumps(manifest, indent=2) + "\n")
    _logger.info("Wrote %s", out)
    return out


def _read_release(source: Path) -> dict | None:
    """The GitHub release the CSVs in ``source`` came from, if we know it.

    The Pages build saves ``apoc-data release get <tag> --json`` beside the
    CSVs it downloads, as ``release.json``. It is only believed if every CSV is
    exactly the size that release says. Otherwise a fresh local scrape into a
    folder that once held a download would go out under the old release's
    date, and the app would tell readers the data is older than it is.
    """
    path = source / RELEASE_FILE
    if not path.exists():
        return None
    raw = json.loads(path.read_text())
    sizes = {asset["name"]: asset["size"] for asset in raw["assets"]}
    mismatched = [
        csv.name
        for csv in sorted(source.glob("*.csv"))
        if sizes.get(csv.name) != csv.stat().st_size
    ]
    if mismatched:
        _logger.warning(
            "Ignoring %s: these CSVs differ from release %s's: %s",
            path,
            raw["tag"],
            ", ".join(mismatched),
        )
        return None
    return {
        "tag": raw["tag"],
        "url": raw["url"],
        "published_at": raw["published_at"],
    }


def _describe_table(
    con: duckdb.DuckDBPyConnection, parquet: Path, *, csv: Path | None, today: date
) -> dict:
    src = _quote_str(str(parquet))
    # The parquet columns are snake_case; the CSV keeps APOC's own headers
    # ("Last/Business Name"). Anyone working from the CSVs -- which is what an
    # AI tool with no web access gets handed -- needs to know both names.
    csv_columns = (
        {
            name: source
            for source, name in _target_names(_column_names(con, csv)).items()
        }
        if csv is not None
        else {}
    )
    columns = [
        {"name": row[0], "type": row[1], "csv_column": csv_columns.get(row[0])}
        for row in con.execute(f"DESCRIBE SELECT * FROM {src}").fetchall()
    ]
    n_rows = con.execute(f"SELECT count(*) FROM {src}").fetchone()[0]  # type: ignore[index]
    table = {
        "name": parquet.stem,
        "file": parquet.name,
        "rows": n_rows,
        "bytes": parquet.stat().st_size,
        "columns": columns,
        "csv_file": f"{parquet.stem}.csv",
        "csv_bytes": csv.stat().st_size if csv is not None else None,
    }
    date_columns = [c["name"] for c in columns if c["type"] == "DATE"]
    if date_columns:
        # The first date column is the transaction/report date, which is the
        # one worth showing as the table's date range.
        date_column = date_columns[0]
        col = _quote_ident(date_column)
        lo, hi, latest = con.execute(
            f"SELECT min({col}), max({col}), max({col}) FILTER (WHERE {col} <= ?)"
            f" FROM {src}",
            [today],
        ).fetchone()  # type: ignore[misc]
        table["date_column"] = date_column
        table["date_min"] = lo.isoformat() if lo else None
        table["date_max"] = hi.isoformat() if hi else None
        # APOC's data has typos dated centuries ahead (a contribution in the
        # year 3015), so date_max says nothing about how current the data is.
        # The newest date that has already happened does.
        table["date_latest"] = latest.isoformat() if latest else None
    return table


def _connect() -> duckdb.DuckDBPyConnection:
    try:
        import duckdb
    except ImportError as e:
        raise SystemExit(
            "Converting to parquet requires extra dependencies. "
            'Install them with the "convert" extra, e.g. '
            '`pip install "apoc-data[convert]"` or `uvx "apoc-data[convert]" convert`.'
            f"\n(import failed: {e})"
        ) from e
    return duckdb.connect()
