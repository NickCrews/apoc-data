/**
 * The rows behind whatever the reader has selected.
 *
 * Built with vgplot's `table` input directly rather than through a spec: a
 * spec can't carry the formatting functions that turn a raw 500 into $500.00,
 * and the money column is the one people actually read.
 */

import {vg, type Selection} from '@sqlrooms/mosaic';
import {useEffect, useMemo, useState, type FC} from 'react';
import {wireSortHeaders} from './sortHeader';
import {Mount} from './VgPlot';

const COLUMNS = [
  'date',
  'amount',
  'filer_name',
  'counterparty',
  'city',
  'occupation',
  'employer',
  'office',
  'election_name',
];

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const FORMAT = {
  amount: (value: unknown) =>
    value == null ? '' : money.format(Number(value)),
};

export type RowTableProps = {
  /** The table to read, from `txTable()`. */
  from: string;
  selection: Selection;
  width: number;
  ready: boolean;
};

export const RowTable: FC<RowTableProps> = ({from, selection, width, ready}) => {
  const [element, setElement] = useState<HTMLElement>();

  const widths = useMemo(
    () => ({
      date: 100,
      amount: 110,
      filer_name: Math.max(170, Math.round(width * 0.16)),
      counterparty: Math.max(170, Math.round(width * 0.16)),
      city: 120,
      occupation: 140,
      employer: 140,
      office: 150,
      election_name: 180,
    }),
    [width],
  );

  useEffect(() => {
    if (!ready) return;
    const el = vg.table({
      from,
      filterBy: selection,
      columns: COLUMNS,
      align: {amount: 'right'},
      format: FORMAT,
      width: widths,
      height: 340,
    }) as HTMLElement;
    setElement(el);
    const unwire = wireSortHeaders(el);
    return () => {
      unwire();
      // Otherwise the old table keeps answering the coordinator's queries
      // after a dataset switch.
      const client = (el as unknown as {value?: unknown}).value;
      if (client) vg.coordinator().disconnect(client as never);
    };
  }, [from, selection, widths, ready]);

  if (!element) return null;
  return <Mount element={element} className="apoc-table overflow-x-auto" />;
};
