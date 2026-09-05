/**
 * The search box that sits in one column's header.
 *
 * A bar chart can only offer the values it drew, so a column with thousands of
 * them gets a box to type in instead: the reader is looking for a value, not
 * surveying them. It publishes a `contains` clause into the same crossfilter
 * selection the header charts use, so typing here narrows every other column's
 * distribution exactly as clicking a bar does.
 *
 * Built as plain DOM rather than a React component because the header cells
 * are Mosaic's -- they arrive whenever the table has its schema, and are
 * decorated in place.
 */

import type {Selection} from '@sqlrooms/mosaic';
import {clauseMatch} from '@uwdata/mosaic-core';
import type {ManifestColumn} from '../manifest';

/**
 * Long enough that a typed word is one filter rather than five, short enough
 * that a reader who has stopped typing doesn't notice waiting.
 */
const DEBOUNCE_MS = 200;

/** What the box is holding, and what the table is actually filtered by. */
export type SearchState = {
  query: string;
  /** Lags `query` by the debounce, which is what "settling" means. */
  applied: string;
};

export type ColumnSearch = {
  /** The element to put in the header cell. */
  element: HTMLElement;
  /** Empties the box without publishing; the caller resets the selection. */
  clear(): void;
  dispose(): void;
};

export function columnSearch({
  column,
  selection,
  onChange,
}: {
  column: ManifestColumn;
  selection: Selection;
  onChange: (name: string, state: SearchState) => void;
}): ColumnSearch {
  const element = document.createElement('div');
  element.className = 'apoc-column-search';
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Search…';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', `Search ${column.name}`);
  element.appendChild(input);

  // Clauses replace earlier ones from the same source, so each box needs an
  // identity of its own -- distinct from every other box's, and from every
  // chart's.
  const source = {name: `search:${column.name}`};

  // An empty box that has never been typed in has nothing to say. Publishing
  // it anyway would be a whole fan-out to arrive back where the page already
  // is -- and, because a new clause abandons the queries in flight, it would
  // do that by cancelling the table's first load.
  let published = false;
  let applied = '';
  let handle: ReturnType<typeof setTimeout> | undefined;

  const report = () => onChange(column.name, {query: input.value.trim(), applied});

  const publish = () => {
    handle = undefined;
    const query = input.value.trim();
    selection.update(
      clauseMatch(column.name, query || null, {source} as never) as never,
    );
    published = true;
    applied = query;
    report();
  };

  const onInput = () => {
    if (handle) clearTimeout(handle);
    const query = input.value.trim();
    if (!query && !published) {
      // Nothing was ever filtered, so there is nothing to unfilter.
      applied = '';
      report();
      return;
    }
    report();
    handle = setTimeout(publish, DEBOUNCE_MS);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // A reader who has pressed Enter has stopped typing; waiting out the rest
    // of the debounce only looks like lag.
    if (event.key === 'Enter' && handle) {
      clearTimeout(handle);
      publish();
    }
  };

  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeyDown);

  return {
    element,
    clear() {
      if (handle) clearTimeout(handle);
      handle = undefined;
      input.value = '';
      applied = '';
      // The caller drops every clause at once; this box's would be re-published
      // as an empty one for no reason.
      published = false;
      report();
    },
    dispose() {
      if (handle) clearTimeout(handle);
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKeyDown);
    },
  };
}
