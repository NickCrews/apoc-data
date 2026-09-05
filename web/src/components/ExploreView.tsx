/**
 * The landing view: a cross-filtering dashboard over APOC's transactions.
 *
 * Everything here is driven by clicking and dragging — no SQL. One crossfilter
 * Selection ties the summary numbers, every chart and the row table together,
 * so narrowing any one of them narrows all of the others.
 */

import type {Spec} from '@sqlrooms/mosaic';
import {Button, cn} from '@sqlrooms/ui';
import {RotateCcwIcon} from 'lucide-react';
import {useEffect, useMemo, useState, type FC} from 'react';
import {APOC_URL, TRANSACTION_TABLES, type TransactionTable} from '../config';
import {crossfilter, useSelectionPending} from '../coordinator';
import {findTable, formatCount, useManifest} from '../manifest';
import {useRoomStore} from '../store';
import {useTabs} from '../tabs';
import {useIsDark} from '../theme';
import {Plot, useElementWidth, type PlotParams} from './VgPlot';
import {StatRow} from './StatRow';
import {timeSpec, topBarSpec, txTable, txTableSql} from './dashboardSpec';
import {RowTable} from './RowTable';
import {SearchFilter} from './SearchFilter';
import {Updating} from './Updating';

/**
 * Slot 1 (blue) for money coming in, slot 2 (orange) for money going out, each
 * stepped for its theme. The two never share a screen, so they only ever have
 * to read clearly against the surface, which both do.
 */
const ACCENTS: Record<string, {light: string; dark: string}> = {
  income: {light: '#2a78d6', dark: '#3987e5'},
  expenditures: {light: '#eb6834', dark: '#d95926'},
};

export const ExploreView: FC = () => {
  const [dataset, setDataset] = useState<TransactionTable>(
    TRANSACTION_TABLES[0],
  );
  const isDark = useIsDark();
  const accent = ACCENTS[dataset.name]![isDark ? 'dark' : 'light']!;

  const connector = useRoomStore((s) => s.db.connector);
  const mosaicReady = useRoomStore((s) => s.mosaic.connection.status === 'ready');
  const tableLoaded = useRoomStore((s) =>
    Boolean(s.db.findTableByName(dataset.name)),
  );

  // Each direction of money gets its own table, which the charts read by name.
  // We track which one exists rather than a boolean: the moment the reader
  // switches datasets, the specs point at a table that hasn't been built yet,
  // and rendering them then would query something that doesn't exist.
  const from = txTable(dataset.name);
  const [readyTable, setReadyTable] = useState<string>();
  const [buildError, setBuildError] = useState<Error>();
  useEffect(() => {
    if (!tableLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        await connector.query(txTableSql(dataset.name));
        if (!cancelled) setReadyTable(txTable(dataset.name));
      } catch (e) {
        if (!cancelled) setBuildError(e as Error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connector, dataset.name, tableLoaded]);

  // A new Selection per dataset: the old charts' clauses mean nothing once the
  // underlying table changes.
  const selection = useMemo(
    () => crossfilter(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataset.name],
  );

  // Held here rather than in the boxes so that "Reset filters" can empty them.
  const [filerQuery, setFilerQuery] = useState('');
  const [counterpartyQuery, setCounterpartyQuery] = useState('');
  const params: PlotParams = useMemo(
    () => new Map([['filter', selection]]),
    [selection],
  );

  const [containerRef, containerWidth] = useElementWidth<HTMLDivElement>();
  const twoUp = containerWidth >= 900;
  const cardWidth = twoUp
    ? Math.floor((containerWidth - 16) / 2) - 32
    : containerWidth - 32;
  const fullWidth = containerWidth - 32;

  const ready = readyTable === from && mosaicReady && containerWidth > 0;

  const specs = useMemo(() => {
    if (cardWidth <= 0) return undefined;
    const opts = {accent, width: cardWidth, from};
    return {
      time: timeSpec({accent, width: fullWidth, from}),
      recipients: topBarSpec('filer_label', opts),
      counterparties: topBarSpec('counterparty_label', opts),
      office: topBarSpec('office', opts, {limit: 10, marginLeft: 150}),
      city: topBarSpec('city', opts, {limit: 10, marginLeft: 150}),
      year: yearMenuSpec(from),
    };
  }, [accent, cardWidth, fullWidth, from]);

  // Every card, total and table below answers this one selection, so they go
  // stale together the moment any of them is filtered.
  const busy = useSelectionPending(selection);

  const {manifest} = useManifest();
  const rows = findTable(manifest, dataset.name)?.rows;
  const {setActiveTab} = useTabs();

  return (
    <div ref={containerRef} className="text-foreground h-full overflow-auto">
      <div className="mx-auto flex flex-col gap-6 p-4">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">
                Alaska campaign finance
              </h1>
              <p className="text-muted-foreground text-sm">
                {dataset.description}
                {rows ? ` · ${formatCount(rows)} records` : ''} · from the{' '}
                <a
                  className="underline underline-offset-2"
                  href={APOC_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Alaska Public Offices Commission
                </a>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="bg-muted flex rounded-md p-0.5">
                {TRANSACTION_TABLES.map((t) => (
                  <button
                    key={t.name}
                    onClick={() => setDataset(t)}
                    className={cn(
                      'rounded px-3 py-1.5 text-sm font-medium transition-colors',
                      t.name === dataset.name
                        ? 'bg-background shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFilerQuery('');
                  setCounterpartyQuery('');
                  selection.reset();
                }}
              >
                <RotateCcwIcon className="h-3.5 w-3.5" />
                Reset filters
              </Button>
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            Click any bar to filter, drag across the timeline to pick a date
            range, or type a name below. Everything on the page updates
            together.
          </p>
        </header>

        {buildError ? (
          <div className="text-destructive font-mono text-xs">
            {buildError.message}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-4">
          <SearchFilter
            label="Candidate or group"
            field="filer_name"
            selection={selection}
            value={filerQuery}
            onChange={setFilerQuery}
            disabled={!ready}
          />
          <SearchFilter
            label={dataset.counterparty}
            field="counterparty"
            selection={selection}
            value={counterpartyQuery}
            onChange={setCounterpartyQuery}
            disabled={!ready}
          />
          <Plot
            spec={specs?.year}
            params={params}
            ready={ready}
            className="apoc-filters flex items-center"
          />
        </div>

        <StatRow
          from={from}
          selection={selection}
          counterpartyLabel={`${dataset.counterparty}s`}
          enabled={ready}
        />

        <Card title="Over time" hint="Drag to select a date range" busy={busy}>
          <Plot spec={specs?.time} params={params} ready={ready} />
        </Card>

        <div
          className={cn('grid gap-4', twoUp ? 'grid-cols-2' : 'grid-cols-1')}
        >
          <Card
            title={
              dataset.name === 'income'
                ? 'Top recipients'
                : 'Top spenders'
            }
            hint="Candidates and groups, by total dollars"
            busy={busy}
          >
            <Plot spec={specs?.recipients} params={params} ready={ready} />
          </Card>
          <Card
            title={`Top ${dataset.counterparty.toLowerCase()}s`}
            hint="By total dollars"
            busy={busy}
          >
            <Plot spec={specs?.counterparties} params={params} ready={ready} />
          </Card>
          <Card title="By office" hint="The office the filer was seeking" busy={busy}>
            <Plot spec={specs?.office} params={params} ready={ready} />
          </Card>
          <Card
            title="By city"
            hint={`Where the ${dataset.counterparty.toLowerCase()} is located`}
            busy={busy}
          >
            <Plot spec={specs?.city} params={params} ready={ready} />
          </Card>
        </div>

        <Card
          title="The matching records"
          hint="Every row behind the numbers above"
          busy={busy}
        >
          <RowTable
            from={from}
            selection={selection}
            width={fullWidth}
            ready={ready}
          />
        </Card>

        <footer className="text-muted-foreground pb-4 text-xs">
          Dates before 2006 or in the future are typos in APOC's data and are
          left out of this dashboard; they're still in the downloadable files.{' '}
          <button
            className="underline underline-offset-2"
            onClick={() => setActiveTab(dataset.name)}
          >
            Download the raw {dataset.name} data
          </button>
          , or open any other file from the tabs above.
        </footer>
      </div>
    </div>
  );
};

const Card: FC<{
  title: string;
  hint?: string;
  /** Whether the chart inside is still catching up with the filters. */
  busy?: boolean;
  children: React.ReactNode;
}> = ({title, hint, busy = false, children}) => (
  <section className="bg-card rounded-lg border p-4">
    <h2 className="text-sm font-semibold">{title}</h2>
    {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    <Updating busy={busy} className="mt-2">
      {children}
    </Updating>
  </section>
);

/** The year picker, which is the one filter Mosaic's own inputs still draw. */
function yearMenuSpec(from: string): Spec {
  return {
    params: {filter: {select: 'crossfilter'}},
    hconcat: [
      {
        input: 'menu',
        from,
        column: 'report_year',
        as: '$filter',
        label: 'Year',
      },
    ],
  };
}
