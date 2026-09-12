/**
 * The `manifest.json` that `apoc-data convert` writes next to the parquet
 * files: row counts, column types and date ranges for every table.
 *
 * Reading it means the Tables panel and the AI prompts can describe the data
 * without querying anything, and stay right when APOC changes a column.
 */

import {useEffect, useState} from 'react';
import {dataUrl} from './config';

export type ManifestColumn = {
  name: string;
  type: string;
  /**
   * The header this column has in the raw CSV, which is APOC's own
   * ("Last/Business Name") rather than the snake_case parquet name. Only the
   * prompt for uploaded CSVs needs it.
   */
  csv_column?: string | null;
};

export type ManifestTable = {
  name: string;
  file: string;
  rows: number;
  bytes: number;
  columns: ManifestColumn[];
  csv_file: string;
  csv_bytes: number | null;
  date_column?: string;
  date_min?: string | null;
  date_max?: string | null;
  /**
   * The newest date that isn't in the future. APOC's data has typos dated
   * centuries ahead, and `date_max` is usually one of them.
   */
  date_latest?: string | null;
};

/** The GitHub release a site was built from. */
export type ManifestRelease = {
  /** eg `20260909-162459`. */
  tag: string;
  /** The release's page, which lists the exact CSVs behind this build. */
  url: string;
  /** When the release was published, which is when its scrape finished. */
  published_at: string;
};

export type Manifest = {
  /** When `apoc-data convert` ran. */
  generated_at: string;
  /**
   * The release the CSVs were downloaded from. Missing for a site built from a
   * local scrape, and from manifests written before it was recorded.
   */
  release?: ManifestRelease | null;
  tables: ManifestTable[];
  /** The archive of every CSV, if this site was built with one. */
  csv_zip?: {file: string; bytes: number};
};

export async function fetchManifest(): Promise<Manifest> {
  const url = dataUrl('manifest.json');
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Couldn't load ${url}: ${response.status}`);
  }
  return (await response.json()) as Manifest;
}

export type ManifestState = {
  manifest: Manifest | undefined;
  error: Error | undefined;
};

export function useManifest(): ManifestState {
  const [state, setState] = useState<ManifestState>({
    manifest: undefined,
    error: undefined,
  });
  useEffect(() => {
    let cancelled = false;
    fetchManifest()
      .then((manifest) => {
        if (!cancelled) setState({manifest, error: undefined});
      })
      .catch((error: Error) => {
        if (!cancelled) setState({manifest: undefined, error});
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

export function findTable(
  manifest: Manifest | undefined,
  name: string,
): ManifestTable | undefined {
  return manifest?.tables.find((t) => t.name === name);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  for (const unit of units) {
    if (n < 1024 || unit === 'GB') {
      return unit === 'B' ? `${n} B` : `${n.toFixed(1)} ${unit}`;
    }
    n /= 1024;
  }
  return `${bytes}`;
}

export function formatCount(n: number | undefined): string {
  return n == null ? '' : n.toLocaleString('en-US');
}

/** eg "2006-10-15" -> "Oct 2006", for the compact date ranges in the UI. */
export function formatMonth(date: string | null | undefined): string {
  if (!date) return '';
  const [year, month] = date.split('-');
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const index = Number(month) - 1;
  return `${monthNames[index] ?? month} ${year}`;
}

/**
 * What a DuckDB type means for the UI: whether a column bins into a histogram,
 * groups into categories, or is free text to search.
 */
const NUMBER =
  /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|DECIMAL|DOUBLE|FLOAT|REAL)/;
const DATE = /^(DATE|TIMESTAMP|TIME)/;

export function isNumber(type: string): boolean {
  return NUMBER.test(type);
}

export function isDate(type: string): boolean {
  return DATE.test(type);
}

export function isText(type: string): boolean {
  return !isNumber(type) && !isDate(type);
}
