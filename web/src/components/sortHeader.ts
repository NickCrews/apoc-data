/**
 * Tristate sort controls in a `vg.table` header.
 *
 * Mosaic's table already sorts on a header click, but the affordance is thin: a
 * tiny caret that only appears once a column is sorted, wedged in front of the
 * name, and a click can only ever toggle asc/desc -- clearing the sort needs a
 * meta-click nobody discovers. This rewires the header so every column carries a
 * visible button after its name that cycles off -> asc -> desc -> off.
 *
 * It works on the DOM Mosaic builds rather than replacing the table: the button
 * is the library's own indicator span, moved and relabelled, and the click still
 * runs the library's handler -- only `client.sort` is swapped for a tristate
 * version that drives the same `sortColumn` / `sortDesc` fields.
 */

type SortState = 'off' | 'asc' | 'desc';

const GLYPH: Record<SortState, string> = {off: '↕', asc: '↑', desc: '↓'};

/** The `Table` input a `vg.table` element carries on its `value` property. */
type TableClient = {
  sortColumn: string | null;
  sortDesc: boolean;
  sortHeader: HTMLElement | null;
  sort: (event: Event, column: string) => void;
  requestData: (offset?: number) => void;
};

/**
 * Wire tristate sort buttons into `element`'s header. Safe to call before
 * Mosaic has built the header row; returns a cleanup that stops waiting.
 */
export function wireSortHeaders(element: HTMLElement): () => void {
  const client = (element as {value?: TableClient}).value;
  if (!client) return () => {};

  let observer: MutationObserver | undefined;

  const nextState = (s: SortState): SortState =>
    s === 'off' ? 'asc' : s === 'asc' ? 'desc' : 'off';

  const stateOf = (column: string): SortState =>
    client.sortColumn !== column ? 'off' : client.sortDesc ? 'desc' : 'asc';

  const setup = (): boolean => {
    const cells = element.querySelectorAll<HTMLTableCellElement>('thead th');
    if (!cells.length) return false;

    const buttons: {column: string; button: HTMLElement}[] = [];

    cells.forEach((cell) => {
      // Mosaic appends a text node with the column name after its indicator
      // span; that text node is the label everything else hangs off.
      const label = [...cell.childNodes].find(
        (node): node is Text =>
          node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
      );
      const column = label?.textContent?.trim() ?? cell.textContent?.trim() ?? '';

      let button = cell.querySelector<HTMLElement>(':scope > span');
      if (!button) {
        button = document.createElement('span');
        cell.appendChild(button);
      }
      button.className = 'apoc-sort';
      button.setAttribute('role', 'button');
      button.setAttribute('tabindex', '0');
      button.setAttribute('aria-label', `Sort by ${column}`);

      // Move the button to just after the name, once.
      if (label && label.nextSibling !== button) {
        cell.insertBefore(button, label.nextSibling);
      }

      buttons.push({column, button});
    });

    const render = () => {
      for (const {column, button} of buttons) {
        const state = stateOf(column);
        if (button.dataset.state !== state) button.dataset.state = state;
        if (button.textContent !== GLYPH[state]) button.textContent = GLYPH[state];
      }
    };

    // Replace the library's asc/desc-only toggle with a tristate cycle. The
    // library's own click listener calls through to this.
    client.sort = (_event: Event, column: string) => {
      const state = nextState(stateOf(column));
      client.sortColumn = state === 'off' ? null : column;
      client.sortDesc = state === 'desc';
      client.sortHeader = null;
      render();
      client.requestData();
    };

    render();
    return true;
  };

  if (!setup()) {
    observer = new MutationObserver(() => {
      if (setup()) observer?.disconnect();
    });
    observer.observe(element, {childList: true, subtree: true});
  }

  return () => observer?.disconnect();
}
