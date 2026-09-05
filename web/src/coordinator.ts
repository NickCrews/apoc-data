/**
 * A Mosaic coordinator that abandons superseded work, and that says what it is
 * still doing.
 *
 * Mosaic's stock coordinator has two habits that make a cross-filter over 1.4M
 * rows feel broken. It submits up to 33 queries at once, which -- since
 * duckdb-wasm runs them one at a time down a single connection -- only moves a
 * whole fan-out inside the worker, where nothing can call it back. And when a
 * newer filter supersedes a client's query, the old one still runs to
 * completion first: type a second letter into the search box and you wait out
 * every query the first letter started before the second one is even sent.
 *
 * So this caps the queue at what duckdb can actually be working on, which
 * leaves the rest of the backlog on our side where a new filter can throw it
 * away, and cancels a client's outstanding query whenever a newer one replaces
 * it.
 *
 * It also records which clients are mid-query. Mosaic tells a client its query
 * is pending, but nothing in the default rendering shows it -- a chart or a
 * total just keeps displaying the previous filter's answer until the new one
 * lands, with no sign that it is out of date. `useSelectionPending` is how a
 * component asks.
 */

import {
  Coordinator,
  coordinator,
  Priority,
  Selection,
  type MosaicClient,
  type QueryResult,
  type QueryType,
} from '@uwdata/mosaic-core';
import {useSyncExternalStore} from 'react';

/**
 * How many queries to let duckdb hold at once.
 *
 * Mosaic submits while `pendingResults.length <= maxConcurrentRequests`, so 1
 * means one query running and one queued behind it: enough to keep the worker
 * busy while the main thread decodes the previous result, and few enough that
 * everything else stays in the queue, where cancelling actually works.
 */
const MAX_CONCURRENT_QUERIES = 1;

/** What Mosaic's QueryManager rejects abandoned queries with. */
const ABANDONED = new Set(['Canceled', 'Cleared']);

function isAbandoned(error: unknown): boolean {
  return typeof error === 'string' && ABANDONED.has(error);
}

class ResponsiveCoordinator extends Coordinator {
  /** The query each client is waiting on, so that a newer one can cancel it. */
  private inflight?: Map<MosaicClient, QueryResult>;
  private listeners?: Set<() => void>;

  constructor() {
    super();
    this.inflight = new Map();
    this.listeners = new Set();

    // Mosaic doesn't export QueryManager, and the cap is private on it, so
    // this is the only way in. If it ever goes missing we lose cancellation
    // rather than correctness -- but it means Mosaic moved, and this file
    // needs another read.
    const manager = this.manager as unknown as {maxConcurrentRequests?: number};
    if (typeof manager.maxConcurrentRequests === 'number') {
      manager.maxConcurrentRequests = MAX_CONCURRENT_QUERIES;
    } else {
      console.warn(
        "Mosaic's QueryManager has no maxConcurrentRequests: queries will be " +
          'submitted faster than they can be cancelled.',
      );
    }
  }

  /**
   * Run a query for a client, dropping whatever it was waiting on before.
   *
   * This is Mosaic's own `updateClient`, with the bookkeeping added. It has to
   * be reimplemented rather than wrapped because the base method keeps the
   * QueryResult to itself, and the QueryResult is the only handle `cancel`
   * takes.
   */
  override updateClient(
    client: MosaicClient,
    query: QueryType,
    priority: number = Priority.Normal,
  ): Promise<unknown> {
    this.abandon(client);
    client.queryPending();

    const result = this.query(query, {priority});
    this.inflight!.set(client, result);
    this.changed();

    const settle = () => {
      if (this.inflight!.get(client) === result) {
        this.inflight!.delete(client);
        this.changed();
      }
    };

    return (client._pending = result
      .then(
        (data) => {
          settle();
          client.queryResult(data).update();
        },
        (error) => {
          settle();
          // An abandoned query isn't a failure: a newer filter replaced it,
          // and that one's answer is already on its way.
          if (!isAbandoned(error)) {
            this.logger()?.error(error);
            client.queryError(error);
          }
        },
      )
      .catch((error) => this.logger()?.error(error)));
  }

  /** A disconnected client's query is nobody's answer. */
  override disconnect(client: MosaicClient): void {
    this.abandon(client);
    super.disconnect(client);
  }

  override clear(options: {clients?: boolean; cache?: boolean} = {}): void {
    super.clear(options);
    // `super()` calls clear() before this instance has any fields yet.
    if (this.inflight?.size) {
      this.inflight.clear();
      this.changed();
    }
  }

  /** Whether any of these clients is still waiting on a query of its own. */
  isClientPending(clients: Iterable<unknown>): boolean {
    if (!this.inflight?.size) return false;
    for (const client of clients) {
      if (client && this.inflight.has(client as MosaicClient)) return true;
    }
    return false;
  }

  /** Whether anything filtered by `selection` is still catching up. */
  isPending(selection: Selection | undefined): boolean {
    if (!selection || !this.inflight?.size) return false;
    const group = this.filterGroups.get(selection);
    if (!group) return false;
    for (const client of group.clients) {
      if (this.inflight.has(client)) return true;
    }
    return false;
  }

  /**
   * Drop every query the clients of `selection` are waiting on.
   *
   * Mosaic won't emit a selection's next value until the fan-out answering its
   * last one has finished, so without this every filter change queues behind a
   * dozen queries computing an answer nobody is going to read. Letting them go
   * ends that wait early. Whatever duckdb has already started still runs to
   * the end -- which is why the queue above is kept short.
   */
  abandonSelection(selection: Selection): void {
    const group = this.filterGroups.get(selection);
    if (!group || !this.inflight?.size) return;
    const dropped: QueryResult[] = [];
    for (const client of group.clients) {
      const result = this.inflight.get(client);
      if (result) dropped.push(result);
    }
    // Rejecting each one runs its own settle(), which is what clears it from
    // `inflight` and tells the page it is still out of date.
    if (dropped.length) this.cancel(dropped);
  }

  subscribe(listener: () => void): () => void {
    this.listeners!.add(listener);
    return () => {
      this.listeners!.delete(listener);
    };
  }

  private abandon(client: MosaicClient): void {
    const previous = this.inflight?.get(client);
    if (!previous) return;
    // Dropped before cancelling, so that the rejection this provokes doesn't
    // mistake itself for the newer query settling.
    this.inflight!.delete(client);
    this.cancel([previous]);
  }

  private changed(): void {
    for (const listener of this.listeners ?? []) listener();
  }
}

let installed: ResponsiveCoordinator | undefined;

/**
 * Make this the coordinator Mosaic uses.
 *
 * Has to run before anything asks for the coordinator -- `coordinator()`
 * builds a stock one on first use and keeps it, so being second means being
 * ignored. See store.ts.
 */
export function installCoordinator(): void {
  if (installed) return;
  installed = new ResponsiveCoordinator();
  // The default connector is a lazy web socket that never gets dialled: the
  // room's duckdb-wasm connector replaces it before the first query.
  coordinator(installed);
}

const subscribe = (listener: () => void): (() => void) =>
  installed ? installed.subscribe(listener) : () => {};

/**
 * Whether anything filtered by `selection` is still querying, so that an
 * output can show it's displaying the last filter's answer rather than this
 * one's.
 *
 * Note that a crossfilter doesn't re-query the chart you're interacting with,
 * so the chart under the pointer stays put while everything else catches up.
 */
export function useSelectionPending(selection: Selection | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => installed?.isPending(selection) ?? false,
  );
}

/**
 * Whether these particular clients are still querying.
 *
 * The selection-wide version above answers for a whole page at once, which is
 * the wrong grain for a table whose header holds a filter per column: one
 * chart catching up would fade the rows, the totals and every other header
 * along with it -- including the box being typed into. Each output asks about
 * its own client instead, so what fades is what is actually out of date.
 *
 * `clients` may be rebuilt on every render; only its contents are read.
 */
export function useClientPending(clients: readonly unknown[]): boolean {
  return useSyncExternalStore(
    subscribe,
    () => installed?.isClientPending(clients) ?? false,
  );
}

/**
 * The same question, for the header charts, which are plain DOM rather than
 * React and so subscribe for themselves.
 */
export function watchClientPending(
  clients: readonly unknown[],
  onChange: (pending: boolean) => void,
): () => void {
  let last: boolean | undefined;
  const read = () => {
    const pending = installed?.isClientPending(clients) ?? false;
    if (pending === last) return;
    last = pending;
    onChange(pending);
  };
  read();
  return subscribe(read);
}

/**
 * A crossfilter selection that abandons the work its last value started.
 *
 * Use this instead of `Selection.crossfilter()` for anything a person drives:
 * it is what turns a filter change from "wait for the old answer, then ask for
 * the new one" into "ask for the new one".
 */
export function crossfilter(): Selection {
  const selection = Selection.crossfilter();
  const update = selection.update.bind(selection);
  selection.update = (clause) => {
    installed?.abandonSelection(selection);
    return update(clause);
  };
  // Clearing the filters is a filter change too, and `reset` goes straight to
  // the Param rather than through `update`, so it needs its own wrapping.
  const reset = selection.reset.bind(selection);
  selection.reset = (clauses) => {
    installed?.abandonSelection(selection);
    return reset(clauses);
  };
  return selection;
}
