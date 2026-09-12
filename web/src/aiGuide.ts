/**
 * What an AI needs to know to answer a question from this data.
 *
 * The same body of knowledge goes out in two shapes, so it lives in one place:
 *
 * - `buildPrompt` is what the "Ask an AI" badge copies to the clipboard, for a
 *   person to paste into a chat. It can't assume the tool on the other end can
 *   fetch a URL, so it opens by making the AI find that out.
 * - `buildLlmsTxt` is the `llms.txt` served at the root of the published site,
 *   for an agent that arrived on its own. That reader has already fetched a URL
 *   to be reading this, so it skips straight to the parquet.
 *
 * Neither one has a schema written down in it. Everything specific -- columns,
 * types, row counts, date ranges, which file is the big one -- is read out of
 * `manifest.json`, because a new scrape lands every day and a hand-copied
 * schema would be wrong within a week.
 *
 * The two then diverge on how much of that to inline. The prompt spells the
 * whole schema out, because its reader may be working from CSVs attached to a
 * chat with no way to fetch anything. llms.txt just links the manifest: its
 * reader demonstrably can fetch, and leaving the numbers out is what keeps the
 * committed copy at the repo root stable enough that its diffs mean something.
 * `scripts/gen-llms-txt.ts` writes both that copy and the one in `_site/`.
 */

import {
  CSV_ZIP_FILE,
  publicCsvUrl,
  publicDataUrl,
  PUBLIC_SITE_BASE_URL,
  REPO_URL,
  tableInfo,
} from './config';
import {
  formatBytes,
  formatCount,
  type Manifest,
  type ManifestTable,
} from './manifest';

/**
 * The prompt for a human to paste: how to get at the data, what the columns
 * mean, and the gotchas that would otherwise produce a confident-sounding wrong
 * answer.
 *
 * It covers both ways in rather than picking one, because the person pasting it
 * has no way of knowing which applies. The AI does, so it's told to find out by
 * trying, and to come back and ask for the zip rather than quietly answering
 * from memory -- which is what a chat assistant with no web access will
 * otherwise do with a prompt full of URLs it can't open.
 */
export function buildPrompt(manifest: Manifest, question: string): string {
  return `I'm analyzing Alaska campaign finance data published by the Alaska Public
Offices Commission (APOC) and mirrored at ${PUBLIC_SITE_BASE_URL}.

FIRST, work out how you can reach the data. Don't skip this and don't guess:

1. Try to fetch ${publicDataUrl('manifest.json')}
   If that works, you can read the Parquet files listed below over HTTPS.
   DuckDB queries them directly, for example:

${indent(EXAMPLE_QUERY, 5)}

2. If you can't fetch URLs then stop, tell me so, and ask me to download

     ${publicCsvUrl(CSV_ZIP_FILE)}

   and add the zip file to this chat. Then wait for me to do it.
   Do not answer from memory and do not estimate anything.

The tables. Each one is a Parquet file at the URL shown and a CSV of the same
name in the zip; the CSV's column headers are the quoted ones:

${describeTables(manifest)}

If you end up working from the CSVs rather than the Parquet, they are APOC's
raw exports and need cleaning first:

${csvCleaning({
  names: 'the lowercase names listed above',
  biggest: biggestCsv(manifest),
})}

Things to know about this data, either way:

${GOTCHAS}

My question: ${question || '<write your question here>'}

Analyze the data, possibly presenting your findings in tables and/or charts,
and point out any assumptions or ambiguities that might affect the answer.
`;
}

/**
 * The `llms.txt` for the published site, in the shape llmstxt.org describes: a
 * title, a one-paragraph summary of what this is, then the detail.
 *
 * Written for an agent that found the file itself, so it leads with the parquet
 * over HTTPS. Deliberately *not* a schema dump: every column, type, row count
 * and date range is already in `manifest.json` two lines down, and any reader
 * that can run the query above can equally run `DESCRIBE`. Repeating it here
 * would triple the file and make it churn on every scrape, which is what stops
 * a generated file from being reviewable in a diff.
 *
 * What's left is the part that lives nowhere else: what a row in each table
 * actually means, and the traps that turn a valid query into a confident wrong
 * answer. Those change when someone edits them, not when the data lands, so
 * this file is committed and its diffs are worth reading.
 */
export function buildLlmsTxt(manifest: Manifest): string {
  return `# Alaska Campaign Finance Data (APOC)

> Every contribution, expenditure, debt and registration reported to the Alaska
> Public Offices Commission, rescraped from the state's site daily and
> republished as typed Parquet and as APOC's raw CSVs. No key, no rate limit,
> CORS enabled, MIT licensed.

Query the Parquet directly over HTTPS — DuckDB fetches only the columns and row
groups a query touches, so counting rows doesn't mean downloading the file:

${indent(EXAMPLE_QUERY, 4)}

If you can't fetch URLs, stop and ask the person you're working for to attach

    ${publicCsvUrl(CSV_ZIP_FILE)}

to the conversation. Do not answer from memory and do not estimate anything.

## Tables

One Parquet file each, at the URL shown, plus a CSV of the same name in the zip.

${listTables(manifest)}

For columns, types, row counts, date ranges, and the CSV header each column was
parsed from, read ${publicDataUrl('manifest.json')}, or run
\`DESCRIBE SELECT * FROM '<url>'\` against any of the files above.

## Things to know before you trust an answer

${GOTCHAS}

## Working from the CSVs instead

They are APOC's raw exports, and need cleaning first:

${csvCleaning({
  names: 'the lowercase names in the manifest',
})}

## More

- [manifest.json](${publicDataUrl('manifest.json')}): every table's columns, types, row counts and date ranges, and when the data was scraped, as JSON
- [All CSVs, zipped](${publicCsvUrl(CSV_ZIP_FILE)}): for tools that can only read files attached to the chat
- [Interactive explorer](${PUBLIC_SITE_BASE_URL}): the same data as a browser dashboard, with a SQL editor, over DuckDB-WASM
- [Source repository](${REPO_URL}): the scraper, the CSV-to-Parquet converter, and a Python API and CLI for the releases
- [APOC's own site](https://aws.state.ak.us/ApocReports/Campaign/): where this is scraped from, and the authority if the two ever disagree
`;
}

/** Each table's name, URL, and the one line saying what a row is. */
function listTables(manifest: Manifest): string {
  return manifest.tables
    .map((table) => {
      const blurb = tableInfo(table.name)?.blurb ?? '';
      return `- ${table.name} — ${blurb}\n  ${publicDataUrl(table.file)}`;
    })
    .join('\n');
}

/** The one query that shows the shape of every other one. */
const EXAMPLE_QUERY = `SELECT filer_name, sum(amount) AS raised
FROM '${publicDataUrl('income.parquet')}'
WHERE report_year = 2024
GROUP BY 1
ORDER BY raised DESC
LIMIT 10;`;

/**
 * The traps, which are the part of this that an agent can't work out from the
 * schema and won't discover from a query that returns a plausible number.
 */
const GOTCHAS = `- Money columns are decimal amounts. Negative amounts are refunds or
  corrections.
- filer_name is the candidate or group that filed the report. In income and
  expenditures, last_business_name/first_name are the other party: the donor
  for income, the payee for expenditures.
- The same person or business is often spelled several different ways, so
  grouping by name alone undercounts. Consider fuzzy matching or grouping on
  a normalized name.
- A few dates are data-entry typos (years like 1934 or 3030).
- report_year is the reporting year, which is not always the year the
  transaction happened — use the date column for that.
- Transaction in 24 hour reports are re-reported in the following report, so don't include both in a total.`;

/**
 * What APOC's raw CSV exports need before they're queryable.
 *
 * The two callers point at different places for the real column names: the
 * prompt has just listed them, while llms.txt deliberately hasn't and sends the
 * reader to the manifest. `biggest` names the file worth warning about by size,
 * which only the prompt carries -- it's a row count, and row counts are the
 * churn that would stop the committed llms.txt from being worth reviewing.
 */
function csvCleaning({
  names,
  biggest,
}: {
  names: string;
  biggest?: string;
}): string {
  return `- Every column is text, under APOC's own headers. Rename them to
  ${names}, which is what everything here calls them.
- Money looks like "$1,234.56", with negatives in parentheses: "($1,234.56)".
  Strip the "$" and the commas, and turn a wrapping "(...)" into a minus sign.
- Dates are M/D/YYYY with no zero padding.
- Some files have a literal "--------" column separating the transaction's own
  fields from the fields describing the filer who reported it. Drop it. A
  header can repeat on either side of it — the one after the separator is the
  filer's.
${biggest ? `- The biggest file by far is ${biggest}.
  If that's too much to load whole, read it in chunks or with a library that
  streams (polars or duckdb rather than pandas defaults), or answer from the
  smaller tables and say which ones you used.` : `- income.csv is far bigger than the rest. If it's too much to load whole,
  read it in chunks or with a library that streams (polars or duckdb rather
  than pandas defaults), or answer from the smaller tables and say which
  ones you used.`}`;
}

/** The file worth warning about by name, and by how much it's the big one. */
function biggestCsv(manifest: Manifest): string {
  const table = manifest.tables.reduce<ManifestTable | undefined>(
    (largest, t) =>
      (t.csv_bytes ?? 0) > (largest?.csv_bytes ?? 0) ? t : largest,
    undefined,
  );
  if (!table) return 'income.csv';
  const size = table.csv_bytes ? `, ${formatBytes(table.csv_bytes)}` : '';
  return `${table.csv_file} (${formatCount(table.rows)} rows${size})`;
}

/** Every table: what a row is, how big it is, and what its columns are called. */
function describeTables(manifest: Manifest): string {
  return manifest.tables.map(describeTable).join('\n\n');
}

function describeTable(table: ManifestTable): string {
  const info = tableInfo(table.name);
  const range =
    table.date_min && table.date_max
      ? `, ${table.date_min} to ${table.date_max}`
      : '';
  const columns = table.columns
    .map((column) => {
      // The CSV header only earns a mention where it differs from the Parquet
      // name, which is most of them but not all.
      const header =
        column.csv_column && column.csv_column !== column.name
          ? ` — ${JSON.stringify(column.csv_column)}`
          : '';
      return `      ${column.name} ${column.type}${header}`;
    })
    .join('\n');

  return [
    `  ${table.name} — ${info?.blurb ?? ''}`,
    `    ${formatCount(table.rows)} rows${range}`,
    `    ${publicDataUrl(table.file)}`,
    `    or ${table.csv_file} in the zip`,
    '    columns:',
    columns,
  ].join('\n');
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n');
}
