/**
 * The distribution that sits in one column's header.
 *
 * Each chart is two marks over the same bins: the whole column, drawn faintly
 * behind, and whatever survives the current filters, drawn on top. The pale
 * one is what makes a filter visible -- on its own, a filtered chart rescales
 * to its own maximum and looks exactly like an unfiltered one, so the reader
 * can see the shape but not that anything was taken away. It also gives the
 * chart a y scale that stops moving, and full-height bars to click even when
 * the filtered ones have gone to nothing.
 *
 * Hovering reads out the bin under the pointer. Plot's own `tip` mark can't be
 * used for that: it lays a hit area over the bars that swallows the click that
 * would have filtered them. So the tooltip here is a plain element positioned
 * from the plot's scales, and the marks keep their pointer events.
 */

import {vg, type Selection} from '@sqlrooms/mosaic';
import {watchClientPending} from '../coordinator';
import {formatCount, isDate, isNumber, type ManifestColumn} from '../manifest';

/** Wide enough for a legible distribution, narrow enough to see a few at once. */
export const COLUMN_WIDTH = 176;
/** The horizontal padding `.apoc-table th` puts around each header. */
const COLUMN_PADDING = 24;
const PLOT_HEIGHT = 50;
/**
 * The most categories a bar chart can show.
 *
 * Also the line between a charted column and a searched one: past this the
 * chart would be showing a dozen of thousands of values while looking like it
 * showed them all, so the header offers a search box instead.
 */
export const CATEGORY_LIMIT = 12;
/** How faint the whole-column shape behind the filtered one is. */
const GHOST_OPACITY = 0.22;
/** How far back a bar the reader's own click excluded fades. */
const UNSELECTED_OPACITY = 0.28;

/** The trimmed copy of a column, which the header histogram bins over. */
export function histColumn(name: string): string {
  return `${name}__hist`;
}

// ---------------------------------------------------------------------------
// Mosaic and Plot both hand back untyped internals. These are the shapes this
// module actually reads, named so the reaching-in is at least visible.

/** Query results as Mosaic holds them: one array per selected column. */
type DataColumns = {
  numRows: number;
  columns: Record<string, ArrayLike<unknown>>;
};

type MarkLike = {data?: DataColumns};

/** A Toggle interactor, told apart from a brush by its `as` channel list. */
type ToggleLike = {as: string[]};

type PlotLike = {marks: MarkLike[]; interactors: unknown[]};

type PlotScale = {
  type: string;
  domain: unknown[];
  bandwidth?: number;
  apply(value: unknown): number;
};

type PlotSvg = SVGSVGElement & {scale(name: string): PlotScale | undefined};

function plotOf(element: HTMLElement): PlotLike | undefined {
  return (element as {value?: PlotLike}).value;
}

function svgOf(element: HTMLElement): PlotSvg | null {
  return element.querySelector('svg') as PlotSvg | null;
}

function isToggle(interactor: unknown): interactor is ToggleLike {
  return Array.isArray((interactor as ToggleLike | undefined)?.as);
}

// ---------------------------------------------------------------------------

/** One bin or category, as the tooltip reads it out. */
export type ChartHit = {
  label: string;
  /** Rows in this bin under the current filters. */
  matching: number;
  /** Rows in this bin over the whole column. */
  total: number;
};

export type ColumnChart = {
  /** The element to put in the header cell. */
  element: HTMLElement;
  /** The column it filters, for whoever is listing what has been filtered. */
  column: string;
  /** Whether it is currently narrowing the table. */
  filtering(): boolean;
  /** Drops the listeners this chart added. Does not disconnect its marks. */
  dispose(): void;
};

export function columnChart({
  from,
  column,
  selection,
  accent,
  trimmed,
  tooltip,
}: {
  /** The view to read, which the file's own view carries. */
  from: string;
  column: ManifestColumn;
  selection: Selection;
  accent: string;
  /** Whether the view carries a trimmed copy of this column to bin over. */
  trimmed: boolean;
  tooltip: ChartTooltip;
}): ColumnChart {
  const whole = vg.from(from);
  const filtered = vg.from(from, {filterBy: selection});
  const frame = [
    vg.width(COLUMN_WIDTH - COLUMN_PADDING),
    vg.height(PLOT_HEIGHT),
    vg.marginLeft(0),
    vg.marginRight(0),
    vg.marginTop(2),
    vg.marginBottom(15),
    vg.yAxis(null),
    vg.yLabel(null),
    vg.xLabel(null),
    vg.style({fontSize: '9px'}),
  ];
  // The filtered mark sits on top and must not intercept anything: the click
  // and the brush both belong to the full-height mark underneath, and so does
  // the datum the tooltip reads.
  const overlay = {fill: accent, inset: 0.5, pointerEvents: 'none'};
  const under = {fill: accent, fillOpacity: GHOST_OPACITY, inset: 0.5};

  let element: HTMLElement;
  if (isNumber(column.type) || isDate(column.type)) {
    const field = trimmed ? histColumn(column.name) : column.name;
    element = vg.plot(
      vg.rectY(whole, {x: vg.bin(field), y: vg.count(), ...under}),
      // Directives bind to the last mark added, so this brushes the mark above.
      vg.intervalX({
        as: selection,
        brush: {
          fill: accent,
          fillOpacity: 0.12,
          stroke: accent,
          strokeOpacity: 0.6,
        },
      }),
      vg.rectY(filtered, {x: vg.bin(field), y: vg.count(), ...overlay}),
      // Without a fixed domain the axis rescales to whatever survives the
      // filter, so the brush you just drew appears to cover everything.
      vg.xDomain(vg.Fixed),
      vg.xTicks(3),
      ...(isDate(column.type)
        ? [vg.xScale('utc')]
        : [vg.xTickFormat('~s' as never)]),
      ...frame,
    ) as HTMLElement;
  } else {
    // Anything else is read as a category: the values people actually see in
    // the column, tallest first, with the rest left out. Only the whole-column
    // mark sorts -- it sets the band domain, and the filtered mark, whose
    // order shifts as rows drop away, follows it.
    element = vg.plot(
      vg.barY(whole, {
        x: column.name,
        y: vg.count(),
        sort: {x: '-y', limit: CATEGORY_LIMIT},
        ...under,
      }),
      vg.toggleX({as: selection}),
      vg.barY(filtered, {x: column.name, y: vg.count(), ...overlay}),
      // Said outright, because Plot otherwise warns about columns of digits
      // that are really categories, like a zip code.
      vg.xScale('band'),
      vg.xAxis(null),
      ...frame,
    ) as HTMLElement;
  }

  // This chart alone, not the page: a header full of filters means most of
  // what is on screen is up to date most of the time, and fading all of it
  // because one column is re-counting says the opposite. A crossfilter doesn't
  // re-query the chart its clause came from, so a chart marked out of date is
  // always one answering somebody else's filter.
  const unwatch = watchClientPending(plotOf(element)?.marks ?? [], (pending) => {
    if (pending) element.dataset.updating = '';
    else delete element.dataset.updating;
  });

  const onMove = (event: PointerEvent) => {
    // Mid-drag the reader is drawing a brush, not reading a bar.
    const hit = event.buttons ? undefined : hitAt(element, column, event);
    if (hit) tooltip.show(hit, event.clientX, event.clientY);
    else tooltip.hide();
  };
  const onLeave = () => tooltip.hide();
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerdown', onLeave);
  element.addEventListener('pointerleave', onLeave);

  // Which bars are chosen has to be painted on twice over. A click on this
  // chart doesn't redraw it -- a crossfilter clause never reaches the chart it
  // came from -- so the selection itself is the only signal there. Any other
  // column's filter does redraw it, and Plot replaces the whole SVG when it
  // does, taking the last coat of paint with it.
  const repaint = () => paintSelection(element, selection);
  selection.addEventListener('value', repaint);
  const observer = new MutationObserver(repaint);
  observer.observe(element, {childList: true});

  return {
    element,
    column: column.name,
    filtering() {
      // The interactor is the clause's source, so the selection answers this
      // directly -- and answers it for a brush that was drawn and then cleared,
      // whose clause stays behind holding nothing.
      const interactors = plotOf(element)?.interactors ?? [];
      return interactors.some((interactor) => {
        const value = selection.valueFor(interactor);
        return Array.isArray(value) ? value.length > 0 : value != null;
      });
    },
    dispose() {
      unwatch();
      observer.disconnect();
      selection.removeEventListener('value', repaint);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerdown', onLeave);
      element.removeEventListener('pointerleave', onLeave);
      tooltip.hide();
    },
  };
}

/**
 * Dim the categories a click left out.
 *
 * A crossfilter selection deliberately doesn't apply to the chart it came
 * from, so clicking a bar changes every other column and leaves this one
 * looking untouched. Fading its peers is what says which bar was chosen.
 */
function paintSelection(element: HTMLElement, selection: Selection): void {
  const plot = plotOf(element);
  const svg = svgOf(element);
  if (!plot || !svg) return;
  const toggle = plot.interactors.find(isToggle);
  if (!toggle) return; // a brushed histogram shows its own selection

  // Read the clause rather than the interactor's own state: a global reset
  // drops the clause but leaves a Toggle still holding its last value.
  const chosen = selection.valueFor(toggle) as unknown[][] | undefined;
  const keys = chosen?.length
    ? new Set(chosen.map((point) => String(point[0])))
    : undefined;
  const key = toggle.as[0];

  plot.marks.forEach((mark, index) => {
    const group = svg.querySelector(`[data-index="${index}"]`);
    const values = key ? mark.data?.columns[key] : undefined;
    if (!group) return;
    for (const bar of group.querySelectorAll('rect')) {
      const i = (bar as {__data__?: unknown}).__data__;
      const value = values && typeof i === 'number' ? values[i] : undefined;
      const dim = keys && !(value !== undefined && keys.has(String(value)));
      bar.style.opacity = dim ? String(UNSELECTED_OPACITY) : '';
    }
  });
}

/** The bin or category under the pointer, if it is over one. */
function hitAt(
  element: HTMLElement,
  column: ManifestColumn,
  event: PointerEvent,
): ChartHit | undefined {
  const plot = plotOf(element);
  const svg = svgOf(element);
  const x = svg?.scale('x');
  const [whole, filtered] = plot?.marks ?? [];
  const data = whole?.data;
  if (!svg || !x || !data) return undefined;

  const box = svg.getBoundingClientRect();
  if (!box.width) return undefined;
  const width = Number(svg.getAttribute('width')) || box.width;
  const px = ((event.clientX - box.left) * width) / box.width;

  if (x.type === 'band') {
    // The domain is already capped at the bars actually drawn, so this walks a
    // dozen values rather than however many the column happens to hold.
    const band = x.bandwidth ?? 0;
    for (const value of x.domain) {
      const left = x.apply(value);
      if (!Number.isFinite(left) || px < left || px >= left + band) continue;
      const key = String(value);
      return {
        label: value == null || key === '' ? '(blank)' : key,
        total: countsOf(whole, column.name).get(key) ?? 0,
        matching: countsOf(filtered, column.name).get(key) ?? 0,
      };
    }
    return undefined;
  }

  const {x1, x2, y} = data.columns;
  if (!x1 || !x2 || !y) return undefined;
  const matching = countsOf(filtered, 'x1');
  for (let i = 0; i < data.numRows; ++i) {
    const left = x.apply(x1[i]);
    const right = x.apply(x2[i]);
    if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
    if (px < Math.min(left, right) || px >= Math.max(left, right)) continue;
    return {
      label: formatBin(column, x1[i], x2[i]),
      total: Number(y[i]),
      // Both marks bin the same column over the same extent, so the lower
      // edge identifies the bin. A bin the filter emptied is simply absent.
      matching: matching.get(String(x1[i])) ?? 0,
    };
  }
  return undefined;
}

/**
 * A mark's counts, by the value of its `key` column.
 *
 * Cached against the result object Mosaic swaps in on each query, so hovering
 * along a chart doesn't rebuild the same lookup on every pointer move.
 */
const countCache = new WeakMap<DataColumns, Map<string, number>>();
const NO_COUNTS = new Map<string, number>();

function countsOf(mark: MarkLike | undefined, key: string): Map<string, number> {
  const data = mark?.data;
  if (!data) return NO_COUNTS;
  const cached = countCache.get(data);
  if (cached) return cached;
  const values = data.columns[key];
  const counts = data.columns.y;
  const map = new Map<string, number>();
  if (values && counts) {
    for (let i = 0; i < data.numRows; ++i) {
      map.set(String(values[i]), Number(counts[i]));
    }
  }
  countCache.set(data, map);
  return map;
}

const DAY = 24 * 60 * 60 * 1000;

function formatBin(column: ManifestColumn, lo: unknown, hi: unknown): string {
  const a = Number(lo);
  const b = Number(hi);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '';
  return isDate(column.type)
    ? formatDateBin(a, b)
    : formatNumberBin(Math.min(a, b), Math.max(a, b));
}

function formatDateBin(lo: number, hi: number): string {
  const span = Math.abs(hi - lo);
  const parts: Intl.DateTimeFormatOptions =
    span >= 300 * DAY
      ? {year: 'numeric'}
      : span >= 20 * DAY
        ? {year: 'numeric', month: 'short'}
        : span >= DAY
          ? {year: 'numeric', month: 'short', day: 'numeric'}
          : {year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric'};
  const format = new Intl.DateTimeFormat('en-US', {...parts, timeZone: 'UTC'});
  // The upper edge is exclusive, so a bin covering exactly one month reads as
  // that month rather than as a range ending in the next one.
  const first = format.format(new Date(lo));
  const last = format.format(new Date(hi - 1));
  return first === last ? first : `${first} – ${last}`;
}

function formatNumberBin(lo: number, hi: number): string {
  // Enough decimals to tell one bin's edges from the next one's, and no more.
  const step = hi - lo;
  const digits =
    step >= 10 ? 0 : step >= 1 ? 1 : Math.min(6, Math.ceil(-Math.log10(step)));
  const format = new Intl.NumberFormat('en-US', {maximumFractionDigits: digits});
  return `${format.format(lo)} – ${format.format(hi)}`;
}

/**
 * The one floating readout every header chart on a page shares.
 *
 * It hangs off the body rather than off a header cell: the cells are sticky
 * inside a pane that has to clip its own scrolling, and a tooltip drawn in
 * there would be cut off at the first column's edge.
 */
export class ChartTooltip {
  private readonly root = document.createElement('div');
  private readonly label = document.createElement('div');
  private readonly count = document.createElement('div');
  private readonly total = document.createElement('div');

  constructor() {
    this.root.className = 'apoc-chart-tip';
    this.label.className = 'apoc-chart-tip-label';
    this.count.className = 'apoc-chart-tip-count';
    this.total.className = 'apoc-chart-tip-total';
    this.root.append(this.label, this.count, this.total);
    this.root.hidden = true;
  }

  show(hit: ChartHit, clientX: number, clientY: number): void {
    // Attached on the way up rather than in the constructor: React mounts an
    // effect twice in development, and a tooltip that took its place in the
    // document on the way in would be detached again by the first teardown.
    if (!this.root.isConnected) document.body.appendChild(this.root);
    this.label.textContent = hit.label;
    this.count.textContent = `${formatCount(hit.matching)} row${
      hit.matching === 1 ? '' : 's'
    }`;
    // Only worth saying once something has been filtered away.
    const narrowed = hit.matching !== hit.total;
    this.total.textContent = narrowed ? `of ${formatCount(hit.total)}` : '';
    this.total.hidden = !narrowed;
    this.root.hidden = false;

    const {width, height} = this.root.getBoundingClientRect();
    const right = window.innerWidth - width - 8;
    const left = Math.max(8, Math.min(clientX + 14, right));
    const below = clientY + 18;
    const top = below + height > window.innerHeight ? clientY - height - 12 : below;
    this.root.style.transform = `translate(${left}px, ${Math.max(8, top)}px)`;
  }

  hide(): void {
    this.root.hidden = true;
  }

  destroy(): void {
    this.root.remove();
  }
}
