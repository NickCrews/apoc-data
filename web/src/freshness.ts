/**
 * How old the data on screen is.
 *
 * What a reader wants to know is when the data was scraped from APOC. The
 * Pages build records the GitHub release it was built from in the manifest,
 * and a release is published the moment its scrape finishes. A site built from
 * a local scrape has no release, so it falls back to when the CSVs were
 * converted, which there is close enough.
 */

import {useEffect, useState} from 'react';
import {TRANSACTION_TABLES} from './config';
import type {Manifest, ManifestRelease} from './manifest';

/**
 * How old the data can get before we say the daily update has stalled.
 *
 * GitHub has started the daily scrape as much as four hours late, and the
 * scrape itself takes anywhere from half an hour to a few, so a healthy site
 * can be well over a day old just before the next update lands. Much tighter
 * than this and the warning would go off on ordinary mornings.
 */
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export type Freshness = {
  /** When the data was scraped, or failing that, converted. */
  asOf: Date;
  /** The release the data came from, if the site was built from one. */
  release?: ManifestRelease;
  /**
   * The newest contribution or expenditure, as yyyy-mm-dd. That's how current
   * APOC's own records are, which trails our copy by however long filers take.
   */
  newestTransaction?: string;
};

export function dataFreshness(manifest: Manifest): Freshness {
  const release = manifest.release ?? undefined;
  const newestTransaction = manifest.tables
    .filter((t) => TRANSACTION_TABLES.some((tx) => tx.name === t.name))
    .map((t) => t.date_latest)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1);
  return {
    asOf: new Date(release?.published_at ?? manifest.generated_at),
    release,
    newestTransaction,
  };
}

export function isStale(freshness: Freshness, now: Date): boolean {
  return now.getTime() - freshness.asOf.getTime() > STALE_AFTER_MS;
}

/**
 * The time, updated every minute, so "6 hours ago" keeps counting in a tab
 * left open overnight, and the stale warning turns up in it on its own.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** eg "6 hours ago", "3 days ago". */
export function formatAge(asOf: Date, now: Date): string {
  const minutes = Math.round((now.getTime() - asOf.getTime()) / 60_000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

const alaskaTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Anchorage',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

/** In Alaska time, where the filings are made: eg "Sep 9, 8:27 AM AKDT". */
export function formatAlaskaTime(date: Date): string {
  return alaskaTime.format(date);
}

const calendarDay = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** eg "2026-09-10" -> "Sep 10, 2026". A calendar date, so no timezone applies. */
export function formatDay(iso: string): string {
  return calendarDay.format(new Date(`${iso}T00:00:00Z`));
}
