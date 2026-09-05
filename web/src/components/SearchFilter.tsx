/**
 * A debounced text filter over one column.
 *
 * Mosaic ships a search input, but it insists on an autocomplete list: given a
 * table and a column it selects their distinct values and appends one
 * `<option>` per value -- 149,823 of them for a donor name -- and given neither
 * it throws on the list it never fetched, which leaves the selection unable to
 * emit anything after the first keystroke. This publishes the same `contains`
 * clause without the list, and waits for a pause in the typing before it does.
 */

import type {Selection} from '@sqlrooms/mosaic';
import {clauseMatch} from '@uwdata/mosaic-core';
import {Input} from '@sqlrooms/ui';
import {SearchIcon} from 'lucide-react';
import {useEffect, useMemo, useRef, type FC} from 'react';

/**
 * Long enough that a typed word is one filter rather than five, short enough
 * that a reader who has stopped typing doesn't notice waiting.
 */
const DEBOUNCE_MS = 200;

export type SearchFilterProps = {
  label: string;
  /** The column to search, which must exist in the filtered table. */
  field: string;
  selection: Selection;
  /** Held by the caller, so that a "reset filters" can empty the box. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export const SearchFilter: FC<SearchFilterProps> = ({
  label,
  field,
  selection,
  value,
  onChange,
  disabled,
}) => {
  // Clauses replace earlier ones from the same source, so each box needs an
  // identity of its own -- distinct from the other box's, and from every
  // chart's.
  const source = useMemo(() => ({name: `search:${field}`}), [field, selection]);

  // An empty box that has never been typed in has nothing to say. Publishing
  // it anyway would be a whole fan-out to arrive back where the page already
  // is -- and, because a new clause abandons the queries in flight, it would
  // do that by cancelling the page's first load.
  const published = useRef(false);

  useEffect(() => {
    if (disabled || (!value.trim() && !published.current)) return;
    const handle = setTimeout(() => {
      selection.update(
        clauseMatch(field, value.trim() || null, {source} as never) as never,
      );
      published.current = true;
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [disabled, field, selection, source, value]);

  return (
    <label className="flex items-center gap-2 text-xs font-medium">
      {label}
      <span className="relative">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5" />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search…"
          className="h-8 w-52 pl-8 text-xs"
          disabled={disabled}
        />
      </span>
    </label>
  );
};
