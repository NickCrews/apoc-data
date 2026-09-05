/**
 * Handing the reader a file duckdb makes on the spot.
 *
 * The published files are just URLs -- an `<a download>` is the whole story.
 * A filtered slice has no URL: it exists only as a predicate the reader built
 * out of the column headers, so the file has to be written here. duckdb-wasm
 * can `COPY ... TO` a name in its own in-memory filesystem and hand the bytes
 * back, which is both faster and more faithful (real parquet, duckdb's own CSV
 * quoting) than reassembling rows in JavaScript.
 */

import {isWasmDuckDbConnector} from '@sqlrooms/duckdb';
import type {DuckDbConnector} from '@sqlrooms/duckdb';

export type ExportFormat = 'parquet' | 'csv';

const MIME: Record<ExportFormat, string> = {
  parquet: 'application/vnd.apache.parquet',
  csv: 'text/csv',
};

/** duckdb's `COPY` options for each format. */
const COPY_OPTIONS: Record<ExportFormat, string> = {
  parquet: 'FORMAT PARQUET',
  csv: 'FORMAT CSV, HEADER',
};

/**
 * Run `query`, write the result as `format`, and save it as `fileName`.
 */
export async function downloadQuery(
  connector: DuckDbConnector,
  query: string,
  fileName: string,
  format: ExportFormat,
): Promise<void> {
  if (!isWasmDuckDbConnector(connector)) {
    throw new Error('Exports need the in-browser database.');
  }
  // Somewhere in duckdb's filesystem that nothing else is using; two clicks in
  // quick succession must not land on the same name.
  const scratch = `export-${Date.now()}-${Math.random().toString(36).slice(2)}.${format}`;
  const db = connector.getDb();
  try {
    await connector.query(
      `COPY (${query}) TO '${scratch}' (${COPY_OPTIONS[format]})`,
    );
    const bytes = await db.copyFileToBuffer(scratch);
    saveBlob(new Blob([bytes as BlobPart], {type: MIME[format]}), fileName);
  } finally {
    // The buffer stays in the worker's memory until it's dropped, and these
    // are whole tables.
    await db.dropFile(scratch).catch(() => {});
  }
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Not immediately: Safari needs the URL to still resolve when the click is
  // handled.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
