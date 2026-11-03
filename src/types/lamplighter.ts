/**
 * Quota readings recorded by the Lamplighter plugin, normalized at the API boundary.
 *
 * Lamplighter polls every account on the proxy and also reads the quota providers return on
 * live traffic, so its readings are the page's source of truth: opening the page never sends
 * a request upstream. Instants are epoch milliseconds; unknown instants are null.
 */

/** Window length class: Lamplighter names 5-hour and 7-day windows; others are 'other'. */
export type QuotaWindowKind = '5h' | '7d' | 'other';

export interface LamplighterWindow {
  id: string;
  label: string;
  kind: QuotaWindowKind;
  /** Remaining percent of this account's window, 0..100. */
  remaining: number;
  resetAt: number | null;
  observedAt: number | null;
}

/** One quota group of an account, such as Claude's standard quota or its Fable quota. */
export interface LamplighterGroup {
  key: string;
  /** Group name shared by every account of a service, such as "Claude" or "Gemini". */
  sourceLabel: string;
  windows: LamplighterWindow[];
}

export interface LamplighterAccount {
  authIndex: string;
  provider: string;
  /** Short label Lamplighter uses for the account, such as "Claude#rk". */
  title: string;
  email: string;
  plan: string;
  /** Weight of the account in a pool when `account_weights` sets none. */
  defaultWeight: number;
  unavailable: boolean;
  /** Last failed read, such as a 429 from the provider; earlier readings stay valid. */
  error: string;
  groups: LamplighterGroup[];
}

export interface LamplighterStatus {
  version: string;
  now: number;
  lastPoll: number | null;
  nextPoll: number | null;
  /** Weights set by hand, keyed by credential file name. */
  accountWeights: Record<string, number>;
  /** Display order of quota groups, by source label. */
  groupOrder: string[];
  accounts: LamplighterAccount[];
}

export interface QuotaSample {
  at: number;
  remaining: number;
}

/** History of one window of one account. */
export interface LamplighterSeries {
  groupKey: string;
  windowId: string;
  kind: QuotaWindowKind;
  sourceLabel: string;
  provider: string;
  authIndex: string;
  /** Oldest first. The first sample may precede the requested range. */
  samples: QuotaSample[];
}

export interface LamplighterHistory {
  from: number;
  to: number;
  series: LamplighterSeries[];
}

/** Named history ranges the plugin serves; each ends now. */
export type LamplighterRange = '6h' | '4d' | '8d' | '15d' | '36d';
