/**
 * The order a file's columns are shown in on its page.
 *
 * APOC's exports -- and so our parquet, and so the manifest -- lead with
 * bookkeeping (`result`, `report_year`) and bury the things a reader is
 * actually here for: when the money moved, how much it was, who sent it and who
 * got it. The downloaded files keep APOC's order; this only rearranges the
 * columns of the table on the screen.
 *
 * `orderColumns` never adds or drops a column -- every column the manifest
 * lists comes out exactly once -- it just sorts them:
 *
 *   1. the `LEAD` names, in the order written here (the headline facts),
 *   2. everything else, in the manifest's own order (donor address, employer,
 *      payment method, election -- context you scroll to when you want it),
 *   3. the `TRAIL` names, in the order written here (filing metadata).
 *
 * A name that a given table doesn't have is simply skipped, so one list covers
 * every table: `income` and `expenditures` share a shape, and the registration
 * tables reuse the same words for the same ideas.
 */

import type {ManifestColumn} from './manifest';

/** Pulled to the front, in this order, when the table has them. */
const LEAD = [
  // When it happened.
  'date',
  'begin_date',
  'end_date',
  // How much.
  'amount',
  'balance_remaining',
  'original_amount',
  // Who filed the report -- the candidate or group the money went to or from.
  'filer_name',
  'filer_type',
  'name',
  'display_name',
  // The other party in a transaction (a donor or payee's surname or business),
  // or -- on the registration tables -- the registrant's own name.
  'last_business_name',
  'last_name',
  'first_name',
  'occupation',
  'employer',
  // What kind of transaction.
  'transaction_type',
  'purpose_of_expenditure',
  'description_purpose',
];

/** Pushed to the end, in this order, when the table has them. */
const TRAIL = [
  'report_type',
  'report_year',
  'election',
  'election_name',
  'election_type',
  'municipality',
  'office',
  'previously_registered',
  'amending',
  'status',
  'submitted',
  'result',
];

/**
 * The manifest's columns, reordered for display. Pure: the input array is not
 * touched, and the output holds the same columns.
 */
export function orderColumns(columns: ManifestColumn[]): ManifestColumn[] {
  const by = new Map(columns.map((c) => [c.name, c]));
  const rank = (list: string[]) =>
    list.filter((n) => by.has(n)).map((n) => by.get(n)!);

  const lead = rank(LEAD);
  const trail = rank(TRAIL);
  const seen = new Set([...lead, ...trail].map((c) => c.name));
  const middle = columns.filter((c) => !seen.has(c.name));

  return [...lead, ...middle, ...trail];
}
