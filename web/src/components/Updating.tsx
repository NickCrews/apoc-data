/**
 * An output that admits when it's out of date.
 *
 * Every chart, total and table on a page answers one filter, and until its
 * query comes back it is still showing the previous filter's answer. Left
 * alone that reads as a number that didn't change; faded, with a spinner over
 * it, it reads as a number that hasn't caught up yet.
 *
 * The stale content stays visible and stays interactive on purpose. Blanking
 * it would lose the reader's place, and queries are cancelled and reissued as
 * the filters change, so there is no reason to stop them filtering further.
 */

import {cn, Spinner} from '@sqlrooms/ui';
import type {FC, ReactNode} from 'react';

export type UpdatingProps = {
  /** Whether the query behind this output is still running. */
  busy: boolean;
  children: ReactNode;
  /** Classes for the wrapper, which is what the content is measured against. */
  className?: string;
};

export const Updating: FC<UpdatingProps> = ({busy, children, className}) => (
  // The flag is in the markup, not just in the styling, so that "is this
  // output caught up?" is a question a test can ask.
  <div className={cn('relative', className)} data-updating={busy || undefined}>
    <div
      className={cn(
        'h-full transition-opacity duration-150',
        busy && 'opacity-40',
      )}
    >
      {children}
    </div>
    {busy ? (
      <div className="pointer-events-none absolute top-1 right-1 z-10">
        <Spinner className="text-muted-foreground h-4 w-4" />
      </div>
    ) : null}
  </div>
);
