/**
 * The headline numbers for whatever is currently selected.
 *
 * This is a Mosaic client like the charts are, sharing their crossfilter
 * Selection, so it updates as you click bars and brush the timeline.
 */

import {Query, sql, useMosaicClient, type Selection} from '@sqlrooms/mosaic';
import {cn} from '@sqlrooms/ui';
import {useCallback, type FC} from 'react';
import {useSelectionPending} from '../coordinator';


type StatsRow = {
  n: bigint | number;
  total: number | null;
  filers: bigint | number;
  counterparties: bigint | number;
};

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const count = new Intl.NumberFormat('en-US');

export type StatRowProps = {
  /** The table to summarize, from `txTable()`. */
  from: string;
  selection: Selection;
  /** 'Donors' or 'Payees', depending on which direction money is flowing. */
  counterpartyLabel: string;
  enabled: boolean;
};

export const StatRow: FC<StatRowProps> = ({
  from,
  selection,
  counterpartyLabel,
  enabled,
}) => {
  const query = useCallback(
    (filter: unknown) =>
      Query.from(from)
        .select({
          n: sql`count(*)`,
          total: sql`sum(amount)`,
          filers: sql`count(DISTINCT filer_name)`,
          counterparties: sql`count(DISTINCT counterparty)`,
        })
        .where(filter as never),
    [from],
  );

  const pending = useSelectionPending(selection);
  const {data, isLoading} = useMosaicClient<{
    numRows: number;
    get(i: number): StatsRow | null;
  }>({selection, query, enabled});

  // `isLoading` only covers the first query this client ever runs; every
  // filter after that swaps the numbers out with no warning at all. The
  // pending state is what says these four are still the last filter's.
  const isStale = isLoading || pending;

  const row = data?.numRows ? data.get(0) : undefined;

  return (
    <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
      <Stat
        label="Total"
        value={row ? money.format(Number(row.total ?? 0)) : '—'}
        isStale={isStale}
        hero
      />
      <Stat
        label="Transactions"
        value={row ? count.format(Number(row.n)) : '—'}
        isStale={isStale}
      />
      <Stat
        label="Candidates and groups"
        value={row ? count.format(Number(row.filers)) : '—'}
        isStale={isStale}
      />
      <Stat
        label={counterpartyLabel}
        value={row ? count.format(Number(row.counterparties)) : '—'}
        isStale={isStale}
      />
    </div>
  );
};

const Stat: FC<{
  label: string;
  value: string;
  /** Whether this is still the previous filter's number. */
  isStale: boolean;
  hero?: boolean;
}> = ({label, value, isStale, hero}) => (
  <div>
    <div className="text-muted-foreground text-xs">{label}</div>
    <div
      className={cn(
        'font-semibold',
        hero ? 'text-4xl' : 'text-2xl',
        // Hold the previous value rather than flashing a skeleton.
        isStale && 'opacity-50',
      )}
    >
      {value}
    </div>
  </div>
);
