/**
 * When the data on screen was scraped from APOC.
 *
 * On a normal day that's a small chip at the end of the tab strip, with the
 * details a click away, since nobody needs telling that the data is fresh.
 * When the daily update has stalled, a strip across the top of the page says
 * so. Someone quoting a total in election week needs to know it stopped
 * moving before they quote it, not after.
 */

import {cn, Popover, PopoverContent, PopoverTrigger} from '@sqlrooms/ui';
import {AlertTriangleIcon} from 'lucide-react';
import type {FC} from 'react';
import {APOC_URL, REPO_URL} from '../config';
import {
  dataFreshness,
  formatAge,
  formatAlaskaTime,
  formatDay,
  isStale,
  useNow,
  type Freshness,
} from '../freshness';
import type {Manifest} from '../manifest';

export type DataFreshnessProps = {
  /** Nothing is shown until the manifest has loaded. */
  manifest: Manifest | undefined;
};

export const FreshnessChip: FC<DataFreshnessProps> = ({manifest}) => {
  const now = useNow();
  if (!manifest) return null;
  const freshness = dataFreshness(manifest);
  const stale = isStale(freshness, now);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={formatAlaskaTime(freshness.asOf)}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap transition-colors',
            stale
              ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/70'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'h-2 w-2 rounded-full',
              stale ? 'bg-amber-500' : 'bg-emerald-500',
            )}
          />
          Updated {formatAge(freshness.asOf, now)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 text-sm">
        <FreshnessDetails freshness={freshness} stale={stale} />
      </PopoverContent>
    </Popover>
  );
};

/** Only rendered while the data is stale. */
export const StaleDataBanner: FC<DataFreshnessProps> = ({manifest}) => {
  const now = useNow();
  if (!manifest) return null;
  const freshness = dataFreshness(manifest);
  if (!isStale(freshness, now)) return null;
  return (
    <div className="flex shrink-0 items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        <span className="font-semibold">
          This data was last updated {formatAge(freshness.asOf, now)}.
        </span>{' '}
        The daily download from APOC hasn't succeeded since{' '}
        {formatAlaskaTime(freshness.asOf)}, so anything filed after that is
        missing here.{' '}
        <a
          className="underline underline-offset-2"
          href={APOC_URL}
          target="_blank"
          rel="noreferrer"
        >
          APOC's own site
        </a>{' '}
        has the latest.
      </p>
    </div>
  );
};

const FreshnessDetails: FC<{freshness: Freshness; stale: boolean}> = ({
  freshness: {asOf, release, newestTransaction},
  stale,
}) => (
  <div className="flex flex-col gap-3">
    <Detail
      label={release ? 'Scraped from APOC' : 'Built from a local scrape'}
      value={formatAlaskaTime(asOf)}
    />
    {newestTransaction ? (
      <Detail
        label="Newest contribution or expenditure"
        value={formatDay(newestTransaction)}
      />
    ) : null}
    <p className="text-muted-foreground text-xs">
      {stale
        ? "A fresh copy is normally downloaded every morning, but that hasn't worked since the time above. Anything filed after it is missing here."
        : 'A fresh copy is downloaded from APOC every morning, Alaska time. Anything filed since will show up in the next one.'}
    </p>
    <a
      className="text-xs underline underline-offset-2"
      href={release?.url ?? `${REPO_URL}/releases`}
      target="_blank"
      rel="noreferrer"
    >
      {release ? (
        <>
          The CSVs behind this page{' '}
          {/* A tag broken at its hyphen reads as two things. */}
          <span className="whitespace-nowrap">(release {release.tag})</span>
        </>
      ) : (
        'Every daily release'
      )}
    </a>
  </div>
);

const Detail: FC<{label: string; value: string}> = ({label, value}) => (
  <div>
    <div className="text-muted-foreground text-xs">{label}</div>
    <div className="font-medium">{value}</div>
  </div>
);
