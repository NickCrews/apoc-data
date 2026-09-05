/**
 * One page per published file: its rows, with everything else out of the way.
 *
 * This is what the site used to say on `files.html` -- every downloadable file,
 * with its size -- except that here the file can be searched, filtered and read
 * before anyone downloads 369MB of CSV. The table is the page; what the file is
 * and where to get it fit into one header strip above it.
 */

import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Spinner,
  SpinnerPane,
} from '@sqlrooms/ui';
import {
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  LinkIcon,
  RotateCcwIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FC } from 'react';
import { orderColumns } from '../columnOrder';
import {
  CSV_ZIP_FILE,
  csvUrl,
  dataUrl,
  publicCsvUrl,
  publicDataUrl,
  REPO_URL,
  tableInfo,
  TABLES,
} from '../config';
import { downloadQuery } from '../download';
import {
  findTable,
  formatBytes,
  formatCount,
  useManifest,
  type Manifest,
  type ManifestTable,
} from '../manifest';
import { useRoomStore } from '../store';
import { FileTable, type FileFilterState } from './FileTable';

export type FileViewProps = {
  /** The table name, which is also the stem of both files. */
  name: string;
};

/** Row counts run to seven digits; in a header strip "2.2M" says as much. */
const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Nothing filtered, which is where every file's page starts. */
const NO_FILTER: FileFilterState = { filtered: false, columns: [], busy: false };

/** How many filtered columns the header names before it starts counting. */
const NAMED_COLUMNS = 3;

export const FileView: FC<FileViewProps> = ({ name }) => {
  const { manifest, error } = useManifest();
  const table = findTable(manifest, name);
  const info = tableInfo(name);
  const isPreloaded = TABLES.some((t) => t.name === name);
  const loaded = useRoomStore((s) => Boolean(s.db.findTableByName(name)));

  // APOC's column order in the file; a friendlier one on the page. Memoised so
  // the table below isn't rebuilt on every render.
  const columns = useMemo(
    () => (table ? orderColumns(table.columns) : []),
    [table],
  );

  // What the table's column filters currently leave, so that this header can
  // say so, undo it, and offer it for download. Cleared when the page is
  // pointed at another file, which the table below would otherwise not get
  // around to correcting until its first count came back.
  const [filter, setFilter] = useState<FileFilterState>(NO_FILTER);
  useEffect(() => setFilter(NO_FILTER), [name]);

  // One count rather than two. Unfiltered, the file's own size is the only
  // number there is; filtered, what is left is the number being looked for and
  // the file's size is what makes it mean anything.
  const rows = !table
    ? ''
    : filter.filtered && filter.rows !== undefined
      ? `${formatCount(filter.rows)} of ${compact.format(table.rows)} rows`
      : `${compact.format(table.rows)} rows`;

  return (
    <div className="text-foreground flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-2">
        {/* The blurb is a tooltip rather than a line of its own: it answers a
            question you ask once, and the rows answer it again every time. */}
        <h1 className="text-base font-semibold" title={info?.blurb}>
          {info?.label ?? name}
        </h1>
        <span
          className={cn(
            'text-muted-foreground text-xs tabular-nums transition-opacity',
            filter.busy && 'opacity-40',
          )}
        >
          {rows}
        </span>
        {filter.filtered ? <ResetFilters filter={filter} /> : null}
        {error ? (
          <span className="text-destructive text-xs">{error.message}</span>
        ) : null}
        <div className="ml-auto self-center">
          <DownloadMenu
            name={name}
            table={table}
            manifest={manifest}
            filter={filter}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 p-3">
        {loaded && table ? (
          <FileTable name={name} columns={columns} onFilterChange={setFilter} />
        ) : isPreloaded ? (
          <SpinnerPane className="h-full w-full" />
        ) : (
          <p className="text-muted-foreground text-xs">
            This table isn't loaded into the browser. Download it, or query the
            parquet over HTTPS with DuckDB.
          </p>
        )}
      </div>
    </div>
  );
};

/**
 * The one control that undoes the column headers' filters, and the one place
 * the page says which columns they are.
 *
 * It is here at all only while something is filtered, and it says so in the
 * accent colour, because the filters themselves are scattered across a header
 * row that is usually scrolled halfway off to the right: a row count that has
 * quietly dropped to a tenth of the file, with no visible reason on screen, is
 * a reason to mistrust the data rather than the filter.
 */
const ResetFilters: FC<{ filter: FileFilterState }> = ({ filter }) => {
  const { columns } = filter;
  const extra = columns.length - NAMED_COLUMNS;
  return (
    <Button
      variant="outline"
      size="sm"
      className="border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary h-7 gap-1.5 self-center"
      // Until the table is ready there are no boxes to empty, and clearing the
      // selection alone would leave them holding text that filters nothing.
      disabled={!filter.reset}
      title={
        columns.length
          ? `Filtering on ${columns.join(', ')}`
          : 'Clear the column filters'
      }
      onClick={() => filter.reset?.()}
    >
      <RotateCcwIcon className="h-3.5 w-3.5" />
      Reset filters
      {columns.length ? (
        // Named rather than counted: "reset filters" is a good deal easier to
        // press knowing it would empty `name` and `amount` and nothing else.
        <span className="max-w-72 truncate font-mono text-[11px] opacity-70">
          {columns.slice(0, NAMED_COLUMNS).join(', ')}
          {extra > 0 ? ` +${extra}` : ''}
        </span>
      ) : null}
    </Button>
  );
};

/** One thing you can take away, in whichever of the two ways it offers. */
type DownloadItem = {
  key: string;
  /** What the file is -- a format, mostly. Not a link: the buttons are. */
  label: string;
  /** Its size, once the manifest says. */
  detail?: string;
  /** Where the published file is, if this is one of the published files. */
  href?: string;
  /** The same file at the URL it has on the public site, for copying. */
  publicHref?: string;
  /** Written by duckdb on demand, if it isn't. */
  make?: () => Promise<void>;
};

type DownloadSection = {
  title: string;
  /** The size of the thing being offered: rows, mostly. */
  note?: string;
  items: DownloadItem[];
};

/**
 * Everything on the page you could take with you, widest scope first.
 *
 * Three sections, because they answer three different questions. The whole
 * dataset as a zip is for feeding an AI tool that can't fetch a URL. This
 * table, whole, is the published file. This table as you have filtered it is
 * the reason to have come to the page at all -- it has no URL, so duckdb
 * writes it here, out of the rows already in the browser.
 */
const DownloadMenu: FC<{
  name: string;
  table: ManifestTable | undefined;
  manifest: Manifest | undefined;
  filter: FileFilterState;
}> = ({ name, table, manifest, filter }) => {
  const connector = useRoomStore((s) => s.db.connector);
  const zip = manifest?.csv_zip?.file ?? CSV_ZIP_FILE;
  const parquet = table?.file ?? `${name}.parquet`;
  const csv = table?.csv_file ?? `${name}.csv`;
  const { sql } = filter;

  const sections: DownloadSection[] = [
    {
      title: 'All tables',
      note: manifest ? `${manifest.tables.length} files, CSV` : undefined,
      items: [
        {
          key: 'zip',
          label: zip,
          detail: formatBytes(manifest?.csv_zip?.bytes),
          href: csvUrl(zip),
          publicHref: publicCsvUrl(zip),
        },
      ],
    },
    {
      title: name,
      note: table ? `${formatCount(table.rows)} rows` : undefined,
      items: [
        {
          key: 'parquet',
          label: 'Parquet',
          detail: formatBytes(table?.bytes),
          href: dataUrl(parquet),
          publicHref: publicDataUrl(parquet),
        },
        {
          key: 'csv',
          label: 'CSV',
          detail: formatBytes(table?.csv_bytes),
          href: csvUrl(csv),
          publicHref: publicCsvUrl(csv),
        },
      ],
    },
  ];

  if (sql) {
    sections.push({
      title: `${name}, filtered`,
      note:
        filter.rows === undefined
          ? undefined
          : `${formatCount(filter.rows)} rows`,
      items: (['parquet', 'csv'] as const).map((format) => ({
        key: `filtered-${format}`,
        label: format === 'csv' ? 'CSV' : 'Parquet',
        make: () =>
          downloadQuery(
            connector,
            sql,
            `${name}-filtered.${format}`,
            format,
          ),
      })),
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <DownloadIcon className="h-3.5 w-3.5" />
          Download
          <ChevronDownIcon className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        {sections.map((section, i) => (
          <div key={section.title}>
            {i ? <DropdownMenuSeparator /> : null}
            <div className="flex items-baseline gap-2 px-2 py-1.5">
              <span className="truncate font-mono text-xs font-medium">
                {section.title}
              </span>
              <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                {section.note}
              </span>
            </div>
            {section.items.map((item) => (
              <ItemRow key={item.key} item={item} />
            ))}
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a
            href={`${REPO_URL}/releases`}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground cursor-pointer"
          >
            Older scrapes…
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * The name of one file, then the two things you can do with it.
 *
 * Not a menu item: a row where the whole thing is a link makes the copy button
 * inside it a thing you have to aim around, and closes the menu whenever you
 * miss. The row says what the file is; the buttons act.
 */
const ItemRow: FC<{ item: DownloadItem }> = ({ item }) => {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<Error>();

  // Long enough to be seen, short enough that the tick is gone before anyone
  // wonders whether it's stuck.
  useEffect(() => {
    if (!copied) return;
    const handle = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(handle);
  }, [copied]);

  const download = async () => {
    if (!item.make || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await item.make();
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 px-2 py-0.5">
      <span className="flex-1 truncate text-sm" title={item.label}>
        {item.label}
      </span>
      <span
        className={
          error
            ? 'text-destructive max-w-32 truncate text-xs'
            : 'text-muted-foreground text-xs tabular-nums'
        }
        title={error?.message}
      >
        {error ? error.message : item.detail}
      </span>
      {item.href ? (
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          title={`Download ${item.label}`}
        >
          <a href={item.href} download>
            <DownloadIcon className="h-3.5 w-3.5" />
          </a>
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          title={`Download ${item.label}`}
          disabled={busy}
          onClick={(e) => {
            // The menu stays open: writing the file takes a moment, and its
            // spinner (and any error) live in this row.
            e.preventDefault();
            void download();
          }}
        >
          {busy ? (
            <Spinner className="h-3.5 w-3.5" />
          ) : (
            <DownloadIcon className="h-3.5 w-3.5" />
          )}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        // A filtered slice was made here and is published nowhere, so there is
        // no URL to hand anyone.
        title={
          item.publicHref
            ? `Copy link to ${item.label}`
            : 'Filtered data has no link — download it instead'
        }
        disabled={!item.publicHref}
        onClick={(e) => {
          e.preventDefault();
          if (!item.publicHref) return;
          void navigator.clipboard.writeText(item.publicHref).then(
            () => setCopied(true),
            (err: Error) => setError(err),
          );
        }}
      >
        {copied ? (
          <CheckIcon className="h-3.5 w-3.5" />
        ) : (
          <LinkIcon className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
};
