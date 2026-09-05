/**
 * Where the data lives, and what each table is.
 */

/**
 * Base URL for the parquet files this app queries.
 *
 * In production the app is served from https://<user>.github.io/apoc-data/ and
 * the data sits next to it under `data/`, so the Vite base URL is the right
 * prefix. For local development, run `npm run data` to convert a local scrape
 * into `web/public/data/`, or point this at the live site:
 *
 *     VITE_DATA_BASE_URL=https://nickcrews.github.io/apoc-data/data/ npm run dev
 */
export const DATA_BASE_URL: string =
  import.meta.env.VITE_DATA_BASE_URL || `${import.meta.env.BASE_URL}data/`;

/**
 * The canonical public location of the data.
 *
 * Used for the copy-pasteable prompts and SQL snippets: those get pasted into
 * an AI tool or a terminal somewhere else, where `localhost` would be useless.
 */
export const PUBLIC_SITE_BASE_URL = 'https://nickcrews.github.io/apoc-data/';

export const PUBLIC_DATA_BASE_URL: string =
  import.meta.env.VITE_PUBLIC_DATA_BASE_URL || `${PUBLIC_SITE_BASE_URL}data/`;

export const REPO_URL = 'https://github.com/NickCrews/apoc-data';

export const APOC_URL = 'https://aws.state.ak.us/ApocReports/Campaign/';

export function dataUrl(fileName: string): string {
  return `${DATA_BASE_URL}${fileName}`;
}

export function publicDataUrl(fileName: string): string {
  return `${PUBLIC_DATA_BASE_URL}${fileName}`;
}

/** The raw CSVs sit next to the app, at the root of the Pages site. */
export function csvUrl(fileName: string): string {
  return `${import.meta.env.BASE_URL}${fileName}`;
}

/**
 * Every CSV in one archive, assembled by `scripts/build_site.sh`.
 *
 * It exists for the AI tools that can't fetch a URL: ChatGPT and Gemini answer
 * only from files you upload, so the fallback to "query it over HTTPS" is to
 * hand them the data instead. The manifest carries its size.
 */
export const CSV_ZIP_FILE = 'apoc-csvs.zip';

/** The same CSV, at the URL it has on the public site. */
export function publicCsvUrl(fileName: string): string {
  return `${PUBLIC_SITE_BASE_URL}${fileName}`;
}

export type TableInfo = {
  /** The table name in duckdb, and the parquet file's stem. */
  name: string;
  /** What to call it in the UI, for people who don't know the file names. */
  label: string;
  /** One line explaining what a row means. */
  blurb: string;
};

/**
 * The tables we load on startup, in the order they're shown.
 *
 * These are the eight exports APOC publishes. Anything else that turns up in
 * the manifest still gets listed in the Tables panel and described to the AI
 * prompts; it just isn't preloaded.
 */
export const TABLES: TableInfo[] = [
  {
    name: 'income',
    label: 'Contributions',
    blurb:
      'Every contribution reported to APOC: who gave, how much, and to which candidate or group.',
  },
  {
    name: 'expenditures',
    label: 'Expenditures',
    blurb:
      'Every expenditure reported to APOC: who was paid, how much, and what for.',
  },
  {
    name: 'campaign_form',
    label: 'Campaign reports',
    blurb:
      'One row per filed report: totals for cash on hand, income, expenses and debt over a reporting period.',
  },
  {
    name: 'debt',
    label: 'Debts',
    blurb: 'Outstanding debts a campaign or group reported owing.',
  },
  {
    name: 'candidate_registration',
    label: 'Candidate registrations',
    blurb:
      'Candidates who registered to run, with their committee, treasurer and contact details.',
  },
  {
    name: 'group_registration',
    label: 'Group registrations',
    blurb: 'Registered PACs, political parties and other groups.',
  },
  {
    name: 'entity_registration',
    label: 'Entity registrations',
    blurb: 'Registered entities, such as independent expenditure groups.',
  },
  {
    name: 'letter_of_intent',
    label: 'Letters of intent',
    blurb: 'Letters of intent filed by people considering a run for office.',
  },
];

/** The two tables of individual money transactions, for the dashboard. */
export const TRANSACTION_TABLES = [
  {
    name: 'income',
    label: 'Money in',
    description: 'Contributions to candidates and groups',
    /** What to call the other party in a transaction. */
    counterparty: 'Donor',
  },
  {
    name: 'expenditures',
    label: 'Money out',
    description: 'Spending by candidates and groups',
    counterparty: 'Payee',
  },
] as const;

export type TransactionTable = (typeof TRANSACTION_TABLES)[number];

export function tableInfo(name: string): TableInfo | undefined {
  return TABLES.find((t) => t.name === name);
}
