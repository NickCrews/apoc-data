/**
 * Every row of one file, with a filter in each column header.
 *
 * The header charts, the header search boxes and the rows are all Mosaic
 * clients on one crossfilter Selection: brush a histogram, click a bar or type
 * a name and the rows narrow to it, along with every other column's
 * distribution. It's the dashboard's cross-filtering, applied to a file's own
 * columns rather than to a curated set of charts, so it works for any table
 * APOC publishes.
 *
 * Each column carries whichever filter suits what it holds, which is why there
 * is no search box over the table as a whole: one box across every column at
 * once has to include the columns that hold one value in every row, where
 * `transaction_type = 'Income'` quietly matches all 1.4M rows for "in".
 */

import {
  Query,
  sql,
  useMosaicClient,
  vg,
} from '@sqlrooms/mosaic';
import {Spinner, SpinnerPane} from '@sqlrooms/ui';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FC,
} from 'react';
import {crossfilter, useClientPending} from '../coordinator';
import {
  formatCount,
  isDate,
  isNumber,
  isText,
  type ManifestColumn,
} from '../manifest';
import {useRoomStore} from '../store';
import {useIsDark} from '../theme';
import {
  CATEGORY_LIMIT,
  ChartTooltip,
  columnChart,
  COLUMN_WIDTH,
  histColumn,
  type ColumnChart,
} from './columnChart';
import {columnSearch, type ColumnSearch, type SearchState} from './columnSearch';
import {wireSortHeaders} from './sortHeader';
import {Mount, useElementHeight} from './VgPlot';

/** Until the pane has been measured, and a floor if it is measured tiny. */
const MIN_TABLE_HEIGHT = 320;

/** One unfiltered list, so "nothing is filtered" keeps the same identity. */
const EMPTY: string[] = [];

/** Same blue the dashboard uses for money in, stepped for each theme. */
const ACCENT = {light: '#2a78d6', dark: '#3987e5'};

/**
 * What the column filters currently leave, for whoever wants to say so or take
 * it away.
 *
 * The filters live in the column headers, which are inside this table; the
 * count, the reset and the download menu are all up in the page header. This is
 * what crosses between them.
 */
export type FileFilterState = {
  /** Rows matching the filters, once they have been counted. */
  rows?: number;
  /** Whether anything has actually been narrowed. */
  filtered: boolean;
  /** The columns doing the narrowing, in the order the table shows them. */
  columns: string[];
  /** Whether the count is still catching up with the filters. */
  busy: boolean;
  /** A SELECT over exactly those rows, or nothing until the table is ready. */
  sql?: string;
  /** Clears every column filter, once there is a table to clear them from. */
  reset?: () => void;
};

export type FileTableProps = {
  /** The table name, which is also the file's stem. */
  name: string;
  /** The file's columns, in the order the manifest lists them. */
  columns: ManifestColumn[];
  /** Told whenever the filters, or the count of what they leave, change. */
  onFilterChange?: (state: FileFilterState) => void;
};

export const FileTable: FC<FileTableProps> = ({
  name,
  columns,
  onFilterChange,
}) => {
  const connector = useRoomStore((s) => s.db.connector);
  const mosaicReady = useRoomStore(
    (s) => s.mosaic.connection.status === 'ready',
  );
  const tableLoaded = useRoomStore((s) => Boolean(s.db.findTableByName(name)));
  const accent = ACCENT[useIsDark() ? 'dark' : 'light'];

  // What each column holds, measured once. The headers need it to decide what
  // (and over what range) to draw, and the view below is built from it.
  const profile = useProfile(name, columns, tableLoaded);

  // The charts read a view rather than the table itself, for two reasons.
  // Money is DECIMAL in the parquet, which is right for money but arrives in
  // JavaScript as a Decimal that d3 scales can't measure. And a column with
  // outliers gets a second, trimmed copy to bin over -- Mosaic bins across a
  // column's whole range, so without this the year-3030 typos would squeeze
  // every real date into one bar.
  const view = `file_${name}`;
  const [readyView, setReadyView] = useState<string>();
  const [error, setError] = useState<Error>();
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    (async () => {
      try {
        await connector.query(viewSql(view, name, columns, profile));
        if (!cancelled) setReadyView(view);
      } catch (e) {
        if (!cancelled) setError(e as Error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [columns, connector, name, profile, view]);

  const ready = mosaicReady && readyView === view;

  // A new Selection per file: another file's clauses mean nothing here.
  const selection = useMemo(() => crossfilter(), [name]);

  // The table is as tall as the pane it's given: it is the page, not a panel
  // on it, so it takes the room rather than a fixed 720px of it.
  const [paneRef, paneHeight] = useElementHeight<HTMLDivElement>();

  const [element, setElement] = useState<HTMLElement>();
  useEffect(() => {
    if (!ready || !paneHeight) return;
    const names = columns.map((c) => c.name);
    const table = vg.table({
      from: view,
      filterBy: selection,
      columns: names,
      width: Object.fromEntries(names.map((n) => [n, COLUMN_WIDTH])),
      height: Math.max(paneHeight, MIN_TABLE_HEIGHT),
    }) as HTMLElement;
    setElement(table);
    const unwire = wireSortHeaders(table);
    return () => {
      unwire();
      // Otherwise the old table keeps answering the coordinator's queries
      // after a switch to another file.
      const client = (table as {value?: unknown}).value;
      if (client) vg.coordinator().disconnect(client as never);
      setElement(undefined);
    };
  }, [columns, paneHeight, ready, selection, view]);

  // One readout for the whole page, so a chart doesn't have to own an element
  // that outlives it.
  const tooltip = useMemo(() => new ChartTooltip(), []);
  useEffect(() => () => tooltip.destroy(), [tooltip]);

  // What the header boxes are holding, so the toolbar can say the table is
  // still settling and the reset knows there is something to clear. Counted
  // rather than collected: nothing outside the boxes needs to know which
  // column was given what.
  const states = useRef(new Map<string, SearchState>());
  const searches = useRef<ColumnSearch[]>([]);
  const charts = useRef<ColumnChart[]>([]);
  const [typed, setTyped] = useState(0);
  const [settling, setSettling] = useState(0);
  const noteSearch = useCallback((name: string, state: SearchState) => {
    states.current.set(name, state);
    const all = [...states.current.values()];
    setTyped(all.filter((s) => s.query).length);
    setSettling(all.filter((s) => s.query !== s.applied).length);
  }, []);

  // Mosaic builds the header row once it has the schema, so the summaries are
  // added to the cells whenever that happens rather than right now.
  useEffect(() => {
    if (!element || !profile) return;
    const head = element.querySelector('thead');
    const added: HTMLElement[] = [];
    charts.current = [];
    searches.current = [];

    const decorate = () => {
      const cells = head?.querySelectorAll('th');
      if (!cells || cells.length !== columns.length) return false;
      cells.forEach((cell, i) => {
        const column = columns[i]!;
        const type = document.createElement('div');
        type.className = 'apoc-column-type';
        type.textContent = column.type.toLowerCase();
        cell.appendChild(type);
        added.push(type);

        const host = document.createElement('div');
        host.className = 'apoc-column-summary';
        // The header cell sorts the table when clicked; a click that lands in
        // the chart was meant for the chart. These are native listeners so
        // they run before the cell's own, which React's wouldn't.
        for (const kind of ['click', 'pointerdown', 'mousedown']) {
          host.addEventListener(kind, (e) => e.stopPropagation());
        }
        const role = columnRole(column, profile);
        if (role === 'chart') {
          const chart = columnChart({
            from: view,
            column,
            selection,
            accent,
            trimmed: Boolean(histogramRange(profile.columns[column.name])),
            tooltip,
          });
          host.appendChild(chart.element);
          charts.current.push(chart);
        } else if (role === 'search') {
          const search = columnSearch({column, selection, onChange: noteSearch});
          host.appendChild(search.element);
          searches.current.push(search);
        }
        cell.appendChild(host);
        added.push(host);

        // Said for every column, charted or not: the chart shows twelve bars
        // whether the column holds twelve values or twelve thousand, and a
        // search box shows none at all.
        const stats = document.createElement('div');
        stats.className = 'apoc-column-stats';
        stats.textContent = statsText(profile.columns[column.name]);
        cell.appendChild(stats);
        added.push(stats);
      });
      return true;
    };

    let observer: MutationObserver | undefined;
    if (!decorate() && head) {
      observer = new MutationObserver(() => {
        if (decorate()) observer?.disconnect();
      });
      observer.observe(head, {childList: true, subtree: true});
    }

    return () => {
      observer?.disconnect();
      const coordinator = vg.coordinator();
      for (const chart of charts.current) {
        chart.dispose();
        for (const mark of marksOf(chart.element)) coordinator.disconnect(mark);
      }
      charts.current = [];
      for (const search of searches.current) search.dispose();
      searches.current = [];
      states.current.clear();
      setTyped(0);
      setSettling(0);
      setActive(EMPTY);
      for (const node of added) node.remove();
    };
  }, [accent, columns, element, noteSearch, profile, selection, tooltip, view]);

  // Which columns are doing the narrowing, which is what the header says out
  // loud next to the reset -- "reset filters" is a good deal less alarming when
  // it names the three columns it would empty.
  //
  // Each chart is asked rather than told: a click or a brush publishes straight
  // into the selection without passing through here, so the selection's own
  // "value" event is the one cue that anything changed. The boxes are already
  // reporting, and they are read from the same place so the list stays in the
  // table's column order however the filters were arrived at.
  const [active, setActive] = useState<string[]>(EMPTY);
  useEffect(() => {
    const update = () => {
      const filtering = new Set<string>();
      for (const chart of charts.current) {
        if (chart.filtering()) filtering.add(chart.column);
      }
      for (const [name, state] of states.current) {
        if (state.query) filtering.add(name);
      }
      const next = columns.map((c) => c.name).filter((n) => filtering.has(n));
      // Same names in the same order is the same list: a fresh array every time
      // the selection stirred would re-tell the page header for nothing.
      setActive((prev) =>
        prev.length === next.length && prev.every((n, i) => n === next[i])
          ? prev
          : next.length
            ? next
            : EMPTY,
      );
    };
    update();
    selection.addEventListener('value', update);
    return () => selection.removeEventListener('value', update);
  }, [columns, element, profile, selection, typed]);

  // What's left after the filters, which is the number people are looking for
  // once they've typed something.
  //
  // The predicate is kept as it goes past, because it is also what a download
  // of "the rows you are looking at" has to be built from, and this is the one
  // place Mosaic hands it to us.
  const filter = useRef<unknown>(undefined);
  const {data, client: countClient} = useMosaicClient<{
    numRows: number;
    get(i: number): {n: bigint | number} | null;
  }>({
    selection,
    query: useMemo(
      () => (predicate: unknown) => {
        filter.current = predicate;
        return Query.from(view)
          .select({n: sql`count(*)`})
          .where(predicate as never);
      },
      [view],
    ),
    enabled: ready,
  });
  const matching = data?.numRows ? Number(data.get(0)?.n) : undefined;

  // Each output answers for itself. The rows, the count and every header chart
  // are separate Mosaic clients whose queries land at their own times, and the
  // header search boxes are not clients at all -- fading the lot of them
  // together would mean the box being typed into greys out under the cursor
  // because some other column is still counting.
  //
  // A box that has been typed into but not yet published counts as out of date
  // for the two outputs a filter is read from: the rows and the total.
  const rowsBusy = useClientPending([tableClient(element)]) || settling > 0;
  const countBusy = useClientPending([countClient]) || settling > 0;

  // Nothing to undo until something has been narrowed, so the reset only shows
  // itself when it would do something.
  const isFiltered = Boolean(
    active.length || (profile && matching !== undefined && matching < profile.rows),
  );

  // Emptying the boxes is this table's business -- they are its DOM, not the
  // selection's -- so the header is handed the whole undo rather than the half
  // of it that a bare `selection.reset()` would be.
  const reset = useCallback(() => {
    for (const search of searches.current) search.clear();
    states.current.clear();
    setTyped(0);
    setSettling(0);
    selection.reset();
  }, [selection]);

  // The count and the predicate arrive together, so one is as good a cue as
  // the other for handing both up to the page header.
  useEffect(() => {
    onFilterChange?.({
      rows: matching,
      filtered: isFiltered,
      columns: active,
      busy: countBusy,
      sql: ready ? exportSql(view, columns, filter.current) : undefined,
      reset: ready ? reset : undefined,
    });
  }, [
    active,
    columns,
    countBusy,
    isFiltered,
    matching,
    onFilterChange,
    ready,
    reset,
    view,
  ]);

  return (
    <div className="flex h-full flex-col">
      {/* The measured pane: the whole of what the page gave this table, which
          is what the table is built to fill. The count, the reset and the list
          of what is filtered are up in the page header -- one strip above the
          rows rather than two, and the filters themselves say the rest: they
          are in the column headers, where they are used.

          The out-of-date flag goes on the pane rather than around the table,
          so that the fade it turns on can pick out the rows alone. The header
          is inside the same element, and it holds the filters -- greying out
          the box under the cursor because the rows it filters are re-reading
          is the fastest way to make a search feel like it stopped working. */}
      <div
        ref={paneRef}
        data-updating={rowsBusy || undefined}
        // The width the header charts are drawn at, which the stylesheet holds
        // every column open to. Passed rather than repeated: a chart narrower
        // than its column is a chart the browser has scaled down.
        style={{'--apoc-column-width': `${COLUMN_WIDTH}px`} as CSSProperties}
        className="apoc-table apoc-file-table relative min-h-0 flex-1 overflow-hidden rounded border"
      >
        {error ? (
          <p className="text-destructive p-3 font-mono text-xs">
            {error.message}
          </p>
        ) : element ? (
          <>
            <Mount element={element} className="h-full" />
            {/* Now that every filter is a column's own, landing on nothing is
                an ordinary thing to do, and an empty table under a full header
                row reads as a table that failed to load. */}
            {matching === 0 && !rowsBusy ? (
              <div className="text-muted-foreground pointer-events-none absolute inset-x-0 top-32 text-center text-xs">
                No rows match these filters.
              </div>
            ) : null}
            {rowsBusy ? (
              <div className="pointer-events-none absolute top-1 right-1 z-10">
                <Spinner className="text-muted-foreground h-4 w-4" />
              </div>
            ) : null}
          </>
        ) : (
          <SpinnerPane className="h-full w-full" />
        )}
      </div>
    </div>
  );
};

/**
 * What each column holds, in one pass over the file: how many distinct values,
 * and where the bulk of them sit.
 */
export type ColumnProfile = {
  /**
   * Approximate, and shown to the reader as if it weren't. An exact
   * count(DISTINCT) over twenty text columns of 1.4M rows is seconds of
   * single-threaded WASM; the header is telling you the order of the thing,
   * and a hyperloglog is within a percent of it.
   */
  distinct: number;
  /** Rows where the column is null, or -- for text -- blank. */
  empty: number;
  /** The full range, and the 1st-to-99th percentile of it, for a histogram. */
  min?: number;
  max?: number;
  p1?: number;
  p99?: number;
};

export type Profile = {rows: number; columns: Record<string, ColumnProfile>};

function useProfile(
  table: string,
  columns: ManifestColumn[],
  ready: boolean,
): Profile | undefined {
  const connector = useRoomStore((s) => s.db.connector);
  const [profile, setProfile] = useState<Profile>();
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      const result = await connector.query(profileSql(table, columns));
      const row = result.toArray()[0] as Record<string, unknown> | undefined;
      if (cancelled || !row) return;
      setProfile({
        rows: Number(row.rows_),
        columns: Object.fromEntries(
          columns.map((c) => [
            c.name,
            {
              distinct: Number(row[`${c.name}_distinct`]),
              empty: Number(row[`${c.name}_empty`]),
              min: numberOrUndefined(row[`${c.name}_min`]),
              max: numberOrUndefined(row[`${c.name}_max`]),
              p1: numberOrUndefined(row[`${c.name}_p1`]),
              p99: numberOrUndefined(row[`${c.name}_p99`]),
            },
          ]),
        ),
      });
    })().catch(() => {
      // A profile is a nicety: without it the headers keep their names, and
      // every column is drawn as best we can guess from its type.
      if (!cancelled) setProfile({rows: 0, columns: {}});
    });
    return () => {
      cancelled = true;
    };
  }, [columns, connector, ready, table]);
  return profile;
}

function profileSql(table: string, columns: ManifestColumn[]): string {
  const parts = ['count(*) AS rows_'];
  for (const {name, type} of columns) {
    parts.push(`approx_count_distinct(${name}) AS ${name}_distinct`);
    // A blank string is as empty as a null to anyone reading the column, and
    // APOC's exports are full of both.
    const blank = isText(type)
      ? `${name} IS NULL OR trim(${name}) = ''`
      : `${name} IS NULL`;
    parts.push(`count(*) FILTER (WHERE ${blank}) AS ${name}_empty`);
    if (isDate(type)) {
      // Dates come back as epoch milliseconds, which is what a d3 time scale
      // wants anyway.
      parts.push(
        `epoch_ms(min(${name})) AS ${name}_min`,
        `epoch_ms(max(${name})) AS ${name}_max`,
        `epoch_ms(approx_quantile(${name}, 0.01)) AS ${name}_p1`,
        `epoch_ms(approx_quantile(${name}, 0.99)) AS ${name}_p99`,
      );
    } else if (isNumber(type)) {
      parts.push(
        `min(${name})::DOUBLE AS ${name}_min`,
        `max(${name})::DOUBLE AS ${name}_max`,
        `approx_quantile(${name}::DOUBLE, 0.01)::DOUBLE AS ${name}_p1`,
        `approx_quantile(${name}::DOUBLE, 0.99)::DOUBLE AS ${name}_p99`,
      );
    }
  }
  return `SELECT ${parts.join(', ')} FROM ${table}`;
}

function numberOrUndefined(value: unknown): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The range a histogram should cover, or nothing to cover it all.
 *
 * A handful of typo'd dates in the year 3030, or one $3M contribution among a
 * million $500 ones, flattens every other bar into the axis. When the outliers
 * stretch the range that far past where the data actually lives, the chart
 * shows the middle 98% instead.
 */
function histogramRange(
  profile: ColumnProfile | undefined,
): [number, number] | undefined {
  const {min, max, p1, p99} = profile ?? {};
  if (min == null || max == null || p1 == null || p99 == null) return undefined;
  const bulk = p99 - p1;
  if (bulk <= 0) return undefined;
  return max - min > 4 * bulk ? [p1, p99] : undefined;
}

/** What a column's header offers the reader. */
type ColumnRole = 'chart' | 'search' | 'none';

/**
 * Which filter a column gets.
 *
 * Numbers and dates always bin, so they are always charted. Text is charted
 * only while the chart can show the whole column: past CATEGORY_LIMIT the bars
 * are the top twelve of however many there are, drawn exactly like a chart
 * that showed them all, and clicking one is the only way to filter values the
 * reader can't see. Above that the header offers a box to type in instead --
 * with thousands of donor names you are looking for one, not surveying them.
 *
 * A column holding a single value offers neither. `income.transaction_type` is
 * `'Income'` in all 1.4M rows: there is no bar to click that would take
 * anything away, and no string to type that matches some rows and not others.
 */
function columnRole(column: ManifestColumn, profile: Profile): ColumnRole {
  const distinct = profile.columns[column.name]?.distinct ?? 0;
  if (distinct < 2) return 'none';
  if (isNumber(column.type) || isDate(column.type)) return 'chart';
  return distinct <= CATEGORY_LIMIT ? 'chart' : 'search';
}

/** The line under each header: how many values, and how many rows lack one. */
function statsText(profile: ColumnProfile | undefined): string {
  if (!profile) return '';
  const parts = [`${formatCount(profile.distinct)} distinct`];
  if (profile.empty) parts.push(`${formatCount(profile.empty)} empty`);
  return parts.join(' · ');
}

/** The Mosaic client a `vg.table` element carries, which is the rows' own. */
function tableClient(element: HTMLElement | undefined): unknown {
  return (element as {value?: unknown} | undefined)?.value;
}

/** The clients a plot element connected, so they can be disconnected again. */
function marksOf(plot: HTMLElement): never[] {
  return ((plot as {value?: {marks?: never[]}}).value?.marks ?? []) as never[];
}

/**
 * A query for the filtered rows, as the file's own columns.
 *
 * It reads the view rather than the table, because that is what the filters
 * were built against -- including the trimmed columns a histogram brush
 * publishes clauses over. Naming the manifest's columns leaves those out
 * again, and the DECIMAL money the view widened to DOUBLE (so that d3 could
 * measure it) is narrowed back, so the CSV says 1234.56 rather than
 * 1234.5600000000001.
 */
function exportSql(
  view: string,
  columns: ManifestColumn[],
  filter: unknown,
): string {
  const select = columns.map((c) =>
    c.type.startsWith('DECIMAL') ? `${c.name}::${c.type} AS ${c.name}` : c.name,
  );
  const predicates = (Array.isArray(filter) ? filter : [filter])
    .map((p) => (p == null ? '' : String(p)))
    .filter(Boolean);
  const where = predicates.length ? ` WHERE ${predicates.join(' AND ')}` : '';
  return `SELECT ${select.join(', ')} FROM ${view}${where}`;
}

function viewSql(
  view: string,
  table: string,
  columns: ManifestColumn[],
  profile: Profile,
): string {
  const casts = columns
    .filter((c) => c.type.startsWith('DECIMAL'))
    .map((c) => `${c.name}::DOUBLE AS ${c.name}`);
  const replace = casts.length ? ` REPLACE (${casts.join(', ')})` : '';

  const trimmed = columns.flatMap((c) => {
    const range = histogramRange(profile.columns[c.name]);
    if (!range) return [];
    // Both sides in the same space: the profile reports dates as epoch
    // milliseconds, so the column is converted rather than the bounds.
    const [lo, hi] = range;
    const value = isDate(c.type) ? `epoch_ms(${c.name})` : `${c.name}::DOUBLE`;
    // Outside the trimmed range the value is null, which the histogram leaves
    // out rather than piling into an end bar -- and a brush can't select what
    // it can't see.
    return [
      `CASE WHEN ${value} BETWEEN ${lo} AND ${hi} THEN ${c.name} END AS ${histColumn(c.name)}`,
    ];
  });

  const extra = trimmed.length ? `, ${trimmed.join(', ')}` : '';
  return `CREATE OR REPLACE VIEW ${view} AS SELECT *${replace}${extra} FROM ${table}`;
}

