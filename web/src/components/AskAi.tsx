/**
 * Questions the dashboard can't answer.
 *
 * Rather than teaching a non-technical reader SQL, this hands them a prompt
 * with the whole schema already filled in, ready to paste into whatever AI
 * tool they already use. Whatever query comes back can be run in the SQL
 * editor here, or in duckdb anywhere else.
 *
 * How the AI gets at the data decides whether any of this works: ChatGPT and
 * Gemini have no arbitrary web access, so a prompt pointing at parquet URLs
 * fails there no matter how good the schema is. Nobody knows off the top of
 * their head which tools can fetch a URL, and it isn't a fair thing to ask, so
 * the prompt puts the question to the AI itself -- which does know -- and
 * tells it to send you back here for the zip when the answer is no.
 *
 * It lives in a badge hovering over the bottom-left corner rather than in a
 * panel of its own: it's a side door off the dashboard, not a place to spend
 * time, so it shouldn't cost the dashboard any width until someone opens it.
 */

import { Button, Textarea, cn } from '@sqlrooms/ui';
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type FC } from 'react';
import {
  CSV_ZIP_FILE,
  csvUrl,
  publicCsvUrl,
  publicDataUrl,
  PUBLIC_SITE_BASE_URL,
  tableInfo,
} from '../config';
import {
  formatBytes,
  formatCount,
  useManifest,
  type Manifest,
  type ManifestTable,
} from '../manifest';

const EXAMPLE_QUESTIONS = [
  'Who were the ten biggest donors to candidates for Governor in 2022?',
  'Which industries and employers give the most to Anchorage Assembly candidates?',
  'How much did each mayoral candidate raise from donors outside Alaska?',
  'What did campaigns spend the most money on in the last election?',
  'Which PACs gave to both Republican and Democratic candidates?',
  'How has the average contribution size changed since 2010?',
];

export const AskAiBadge: FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  // Held out here rather than in the card so collapsing the badge doesn't
  // throw away a half-written question.
  const [question, setQuestion] = useState('');

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  return (
    // The wrapper spans only what it contains and lets clicks through
    // everywhere else, so the dashboard underneath stays fully usable while
    // the card is open.
    <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex flex-col items-start gap-2">
      {isOpen ? (
        <AskAiCard
          question={question}
          onQuestionChange={setQuestion}
          onClose={() => setIsOpen(false)}
        />
      ) : null}

      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className={cn(
          'pointer-events-auto flex items-center gap-2 rounded-full border py-2 pr-4 pl-3 text-sm font-medium shadow-lg transition-colors',
          isOpen
            ? 'bg-muted text-foreground hover:bg-muted/80'
            : 'bg-primary text-primary-foreground hover:bg-primary/90 border-transparent',
        )}
      >
        {isOpen ? (
          <XIcon className="h-4 w-4" />
        ) : (
          <SparklesIcon className="h-4 w-4" />
        )}
        {isOpen ? 'Close' : 'Ask an AI'}
      </button>
    </div>
  );
};

const AskAiCard: FC<{
  question: string;
  onQuestionChange: (question: string) => void;
  onClose: () => void;
}> = ({ question, onQuestionChange, onClose }) => {
  const { manifest, error } = useManifest();
  const [copied, setCopied] = useState(false);
  const questionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    questionRef.current?.focus();
  }, []);

  const copy = async () => {
    if (!manifest) return;
    await navigator.clipboard.writeText(buildPrompt(manifest, question));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      role="dialog"
      aria-label="Ask an AI"
      className="apoc-ai-card bg-background text-foreground pointer-events-auto flex max-h-[min(34rem,calc(100vh-8rem))] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border shadow-2xl"
    >
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <SparklesIcon className="text-primary h-4 w-4" />
        <span className="text-sm font-medium">Ask an AI</span>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground hover:bg-muted ml-auto rounded p-1"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-3 overflow-auto p-3">
        <p className="text-muted-foreground text-xs">
          Want an answer this dashboard doesn't give you? Write your question
          below and paste the pre-filled prompt into your favorite AI tool.
        </p>

        <Textarea
          ref={questionRef}
          value={question}
          onChange={(e) => onQuestionChange(e.target.value)}
          placeholder="Who gave the most money to candidates for Anchorage mayor?"
          rows={4}
          className="text-sm"
        />

        <Button onClick={copy} disabled={!manifest}>
          {copied ? (
            <CheckIcon className="h-4 w-4" />
          ) : (
            <CopyIcon className="h-4 w-4" />
          )}
          {copied ? 'Copied — now paste it into your AI tool' : 'Copy prompt'}
        </Button>

        <CsvZipCallout manifest={manifest} />

        {error ? (
          <p className="text-destructive text-xs">{error.message}</p>
        ) : null}

        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-xs font-medium uppercase">
            Or start from one of these
          </p>
          {EXAMPLE_QUESTIONS.map((example) => (
            <button
              key={example}
              onClick={() => onQuestionChange(example)}
              className="hover:bg-muted rounded border px-2 py-1.5 text-left text-xs"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * The zip, kept where the prompt will send someone back to.
 *
 * It sits under the copy button rather than above it, because most of the time
 * it isn't needed: the prompt asks the AI to try the URLs first, and only the
 * tools that can't reach them send you back here for the files.
 */
const CsvZipCallout: FC<{ manifest: Manifest | undefined }> = ({ manifest }) => (
  <div className="bg-muted flex flex-col gap-2 rounded border p-2">
    <p className="text-muted-foreground text-xs">
      If your AI can't reach the internet — ChatGPT and Gemini usually can't —
      it will say so and ask for the data. Download it here and attach it to
      the chat.
    </p>
    <CsvZipButton manifest={manifest} />
  </div>
);

/**
 * One archive of every CSV. The download menu on a file's page offers the same
 * file, but as a menu item rather than a button, so it links to it directly.
 */
const CsvZipButton: FC<{ manifest: Manifest | undefined }> = ({ manifest }) => {
  const zip = manifest?.csv_zip;
  const size = zip ? formatBytes(zip.bytes) : '';
  return (
    <Button asChild size="sm">
      <a href={csvUrl(zip?.file ?? CSV_ZIP_FILE)} download>
        <DownloadIcon className="h-3.5 w-3.5" />
        <span className="flex-1">All CSVs (.zip)</span>
        {size ? <span className="text-xs opacity-70">{size}</span> : null}
      </a>
    </Button>
  );
};

/**
 * The prompt itself: how to get at the data, what the columns mean, and the
 * gotchas that would otherwise produce a confident-sounding wrong answer.
 *
 * It covers both ways in rather than picking one, because the person pasting
 * it has no way of knowing which applies. The AI does, so it's told to find
 * out by trying, and to come back and ask for the zip rather than quietly
 * answering from memory -- which is what a chat assistant with no web access
 * will otherwise do with a prompt full of URLs it can't open.
 */
export function buildPrompt(manifest: Manifest, question: string): string {
  const biggest = biggestCsv(manifest);

  return `I'm analyzing Alaska campaign finance data published by the Alaska Public
Offices Commission (APOC) and mirrored at ${PUBLIC_SITE_BASE_URL}.

FIRST, work out how you can reach the data. Don't skip this and don't guess:

1. Try to fetch ${publicDataUrl('manifest.json')}
   If that works, you can read the Parquet files listed below over HTTPS.
   DuckDB queries them directly, for example:

     SELECT filer_name, sum(amount) AS raised
     FROM '${publicDataUrl('income.parquet')}'
     WHERE report_year = 2024
     GROUP BY 1
     ORDER BY raised DESC
     LIMIT 10;

2. If you can't fetch URLs then stop,
   tell me so, and ask me to download

     ${publicCsvUrl(CSV_ZIP_FILE)}

   and attach the CSVs inside it to this chat. Then wait for me to do it.
   Do not answer from memory and do not estimate any numbers: everything
   below describes data you haven't seen yet.

The tables. Each one is a Parquet file at the URL shown and a CSV of the same
name in the zip; the CSV's column headers are the quoted ones:

${describeTables(manifest)}

If you end up working from the CSVs rather than the Parquet, they are APOC's
raw exports and need cleaning first:

- Every column is text. Rename the headers to the lowercase names above; the
  rest of this prompt uses those names.
- Money looks like "$1,234.56", with negatives in parentheses: "($1,234.56)".
  Strip the "$" and the commas, and turn a wrapping "(...)" into a minus sign.
- Dates are M/D/YYYY with no zero padding.
- Some files have a literal "--------" column separating the transaction's own
  fields from the fields describing the filer who reported it. Drop it. A
  header can repeat on either side of it — the one after the separator is the
  filer's.
- The biggest file by far is ${biggest}.
  If that's too much to load whole, read it in chunks or with a library that
  streams (polars or duckdb rather than pandas defaults), or answer from the
  smaller tables and say which ones you used.

Things to know about this data, either way:

- Money columns are decimal amounts. Negative amounts are refunds or
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
- Rows are as-filed: amended reports appear alongside the originals, so
  totals can double-count unless you account for the status/amending columns.

My question: ${question || '<write your question here>'}

Analyze the data, possibly presenting your findings in tables and/or charts,
and point out any assumptions or ambiguities that might affect the answer.
`;
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
