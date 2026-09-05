/**
 * The Mosaic specs behind the Explore dashboard.
 *
 * Each chart is its own spec so React can lay them out responsively, but they
 * all share one crossfilter `$filter` Selection (injected by `useVgPlot`), so
 * clicking a bar in one narrows every other chart, the row table and the
 * summary numbers.
 */

import type {Spec} from '@sqlrooms/mosaic';

/**
 * The table the charts read from, one per direction of money.
 *
 * The name has to include the source table: Mosaic caches query results by SQL
 * text, so if both datasets were served through one name, switching from money
 * in to money out would re-serve the cached money-in answers.
 */
export function txTable(table: string): string {
  return `tx_${table}`;
}

/** How many bars to show in a "top N" chart. */
const TOP_N = 12;

/**
 * Rows APOC's data says were filed in 1934 or 3030 are typos (there are a
 * couple dozen out of 1.6M). They're still in the underlying tables for anyone
 * querying SQL, but they'd stretch every time axis to uselessness.
 */
const EARLIEST = '2006-01-01';

/**
 * Build the table the dashboard reads.
 *
 * `amount` is DECIMAL in the parquet, which is right for money but arrives in
 * JavaScript as a Decimal that d3 scales can't measure, so this hands charts a
 * DOUBLE. `counterparty` merges the person/business columns into the single
 * name a reader actually wants to see.
 *
 * Materialized rather than a view, because every one of these expressions
 * would otherwise be recomputed over 1.4M rows on every query, and a single
 * cross-filter interaction fans out to a dozen of them. Building it costs
 * about a second once per dataset; it takes the top-donor chart from 238ms to
 * 51ms per query (measured single-threaded, which is what duckdb-wasm is).
 *
 * `IF NOT EXISTS` so that toggling back to a dataset is free rather than
 * paying that second again -- the source table doesn't change within a session.
 */
export function txTableSql(table: string): string {
  return `
    CREATE TABLE IF NOT EXISTS ${txTable(table)} AS
    SELECT
      date,
      amount::DOUBLE AS amount,
      filer_name,
      filer_type,
      nullif(
        trim(coalesce(first_name || ' ', '') || coalesce(last_business_name, '')),
        ''
      ) AS counterparty,
      state,
      occupation,
      employer,
      -- Groups and ballot-measure committees aren't seeking an office, and a
      -- nameless bar at the top of a chart just looks like a bug.
      coalesce(office, 'No office listed') AS office,
      coalesce(city, 'City not stated') AS city,
      election_name,
      municipality,
      ${truncatedSql('filer_name', 'filer_label')},
      ${truncatedSql('counterparty', 'counterparty_label')},
      purpose_of_expenditure AS purpose,
      payment_type,
      report_type,
      report_year
    FROM ${table}
    WHERE date >= DATE '${EARLIEST}' AND date <= current_date
  `;
}

const PARAMS: Spec['params'] = {
  // Seeded with a real Selection by useVgPlot; declared here so each spec is
  // also valid on its own.
  filter: {select: 'crossfilter'},
};

/** Recessive axes, hairline grid, small type: chrome that stays out of the way. */
const PLOT_DEFAULTS = {
  style: {fontSize: '11px'},
  // Note: no '$' in tick formats. Mosaic reads a leading '$' in any spec string
  // as a param reference, so '$~s' would silently resolve to nothing -- the
  // dollar sign lives in the axis label instead.
  xTickFormat: '~s',
  xLabel: 'Total dollars',
  yLabel: null,
} as const;

/**
 * Long committee names run off the left edge of a bar chart, so the view
 * carries a shortened copy of each name the charts group by.
 *
 * This has to be a real column rather than an expression in the chart's own
 * channel: Mosaic answers cross-filter queries out of pre-aggregated tables,
 * and a predicate over an expression can't be resolved against those.
 */
function truncatedSql(column: string, alias: string, max = 26): string {
  return `CASE WHEN length(${column}) > ${max}
            THEN left(${column}, ${max - 1}) || '…'
            ELSE ${column} END AS ${alias}`;
}

export type ChartOptions = {
  /** The accent color for the marks, already resolved for the active theme. */
  accent: string;
  width: number;
  /** The table to read, from `txTable()`. */
  from: string;
};

/** Money over time, brushable to filter everything else to a date range. */
export function timeSpec({accent, width, from}: ChartOptions): Spec {
  return {
    params: PARAMS,
    plot: [
      {
        mark: 'rectY',
        data: {from, filterBy: '$filter'},
        x: {bin: 'date'},
        y: {sum: 'amount'},
        fill: accent,
        // The 2px of surface between bars comes from the inset, not a stroke.
        inset: 1,
      },
      {select: 'intervalX', as: '$filter'},
    ],
    width,
    height: 170,
    marginLeft: 54,
    marginRight: 12,
    marginTop: 20,
    xScale: 'utc',
    xLabel: null,
    yLabel: '↑ Dollars',
    yTickFormat: '~s',
    yGrid: true,
    style: PLOT_DEFAULTS.style,
  };
}

/** A "top N by total dollars" bar chart, clickable to filter. */
export function topBarSpec(
  column: string,
  {accent, width, from}: ChartOptions,
  {limit = TOP_N, marginLeft = 170}: {limit?: number; marginLeft?: number} = {},
): Spec {
  // In a crossfilter, a chart isn't filtered by its own clause -- so without
  // this, clicking a bar changes every chart except the one you clicked, and
  // nothing shows what you picked. The highlight param is per-column (the
  // params map is shared across charts) so each chart highlights its own bars.
  const highlight = `hl_${column}`;
  return {
    params: {...PARAMS, [highlight]: {select: 'intersect'}},
    plot: [
      {
        mark: 'barX',
        data: {from, filterBy: '$filter'},
        x: {sum: 'amount'},
        y: column,
        fill: accent,
        sort: {y: '-x', limit},
        insetTop: 1,
        insetBottom: 1,
        rx: 2,
      },
      // Order matters: the highlight toggle has to be registered before the
      // crossfilter one, or the re-render the crossfilter triggers lands
      // before the highlight has computed which bars to dim, and nothing dims.
      {select: 'toggleY', as: `$${highlight}`},
      {select: 'toggleY', as: '$filter'},
      {select: 'highlight', by: `$${highlight}`, opacity: 0.25},
    ],
    width,
    height: 30 + limit * 20,
    marginLeft,
    marginRight: 16,
    marginTop: 4,
    xGrid: true,
    ...PLOT_DEFAULTS,
  };
}
