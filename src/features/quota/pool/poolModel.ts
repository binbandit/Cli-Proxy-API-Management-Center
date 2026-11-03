/**
 * Quota pools: every account of one quota group added up, weighted by plan, over time.
 *
 * Pure functions over Lamplighter readings. `now` is always passed in, so every case is
 * directly testable. Values are pool percent: an account of weight w at r% remaining adds
 * w * r, so six equal accounts make a 600% pool.
 */

import type {
  LamplighterAccount,
  LamplighterHistory,
  LamplighterStatus,
  LamplighterWindow,
  QuotaSample,
  QuotaWindowKind,
} from '@/types';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';

export interface PoolAccount {
  authIndex: string;
  title: string;
  email: string;
  plan: string;
  weight: number;
  /** Remaining percent now, 0..100. */
  remaining: number;
  resetAt: number | null;
  observedAt: number | null;
  error: string;
  /** Range history, oldest first. */
  samples: QuotaSample[];
  /** Full-resolution history of the last hours, for burn rates. */
  recentSamples: QuotaSample[];
}

export interface Pool {
  id: string;
  /** Quota group shared by the accounts, such as "Claude" or "Gemini". */
  sourceLabel: string;
  provider: string;
  kind: QuotaWindowKind;
  periodMs: number | null;
  accounts: PoolAccount[];
}

export interface ChartPoint {
  at: number;
  value: number;
}

export interface ResetMark {
  at: number;
  /** Pool percent the reset brings back. */
  gain: number;
}

const PERIOD_MS: Record<QuotaWindowKind, number | null> = {
  '5h': 5 * HOUR_MS,
  '7d': 7 * DAY_MS,
  other: null,
};

/** A rise smaller than this between two readings is noise, not a reset. */
const RESET_MIN_RISE = 5;
/** Resets this close together are drawn and labelled as one. */
const RESET_MERGE_MS = 45 * MINUTE_MS;

const byAt = (a: { at: number }, b: { at: number }) => a.at - b.at;

/**
 * The window a pool tracks for one quota group: the weekly window when any account has one,
 * since it is the budget that runs out over days; otherwise the 5-hour window; otherwise
 * whatever single window the group reports.
 */
function poolKind(windows: LamplighterWindow[]): QuotaWindowKind {
  if (windows.some((window) => window.kind === '7d')) return '7d';
  if (windows.some((window) => window.kind === '5h')) return '5h';
  return 'other';
}

export interface BuildPoolsInput {
  status: LamplighterStatus;
  history: LamplighterHistory | null;
  recent: LamplighterHistory | null;
  /** Weight of an account in its pool, after hand-set overrides. */
  weightOf: (account: LamplighterAccount) => number;
}

export function buildPools({ status, history, recent, weightOf }: BuildPoolsInput): Pool[] {
  const samplesFor = (source: LamplighterHistory | null, groupKey: string, windowId: string) =>
    source?.series.find((series) => series.groupKey === groupKey && series.windowId === windowId)
      ?.samples ?? [];

  const groups = new Map<
    string,
    { provider: string; entries: [LamplighterAccount, string, LamplighterWindow[]][] }
  >();
  for (const account of status.accounts) {
    for (const group of account.groups) {
      if (!group.sourceLabel || group.windows.length === 0) continue;
      const bucket = groups.get(group.sourceLabel) ?? { provider: account.provider, entries: [] };
      bucket.entries.push([account, group.key, group.windows]);
      groups.set(group.sourceLabel, bucket);
    }
  }

  const pools: Pool[] = [];
  for (const [sourceLabel, { provider, entries }] of groups) {
    const kind = poolKind(entries.flatMap(([, , windows]) => windows));
    const accounts = entries.flatMap(([account, groupKey, windows]): PoolAccount[] => {
      const window =
        kind === 'other' ? windows[0] : windows.find((candidate) => candidate.kind === kind);
      if (!window) return [];
      return [
        {
          authIndex: account.authIndex,
          title: account.title || sourceLabel,
          email: account.email,
          plan: account.plan,
          weight: weightOf(account),
          remaining: window.remaining,
          resetAt: window.resetAt,
          observedAt: window.observedAt,
          error: account.error,
          samples: samplesFor(history, groupKey, window.id),
          recentSamples: samplesFor(recent, groupKey, window.id),
        },
      ];
    });
    if (accounts.length === 0) continue;
    // Plan weights only compare accounts within a pool, so the smallest plan counts as 1: a
    // pool of three equal plans holds 300%, whatever their absolute size.
    const smallest = Math.min(...accounts.map((account) => account.weight));
    if (smallest > 0) accounts.forEach((account) => (account.weight /= smallest));
    accounts.sort((a, b) => a.title.localeCompare(b.title));
    pools.push({
      id: `${sourceLabel}:${kind}`,
      sourceLabel,
      provider,
      kind,
      periodMs: PERIOD_MS[kind],
      accounts,
    });
  }

  const rank = (label: string) => {
    const index = status.groupOrder.indexOf(label);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return pools.sort((a, b) => rank(a.sourceLabel) - rank(b.sourceLabel));
}

export const poolCapacity = (pool: Pool): number =>
  pool.accounts.reduce((sum, account) => sum + account.weight * 100, 0);

export const poolRemaining = (pool: Pool): number =>
  pool.accounts.reduce((sum, account) => sum + account.weight * account.remaining, 0);

/** Last sample at or before `at`, found by advancing a cursor; `samples` is oldest first. */
function makeCursor(samples: QuotaSample[]) {
  let index = -1;
  return (at: number): number | null => {
    while (index + 1 < samples.length && samples[index + 1].at <= at) index += 1;
    return index >= 0 ? samples[index].remaining : null;
  };
}

/**
 * The recorded pool on a regular grid from `from` to `now`, ending exactly at `now` with the
 * current readings. An account counts from its first sample on, so a credential added
 * mid-range raises the line where it joined instead of being invented backwards.
 */
export function recordedSeries(
  pool: Pool,
  from: number,
  now: number,
  stepMs: number
): ChartPoint[] {
  const cursors = pool.accounts.map((account) => makeCursor(account.samples));
  const points: ChartPoint[] = [];
  for (let at = from; at < now; at += stepMs) {
    let value = 0;
    let known = false;
    pool.accounts.forEach((account, index) => {
      const remaining = cursors[index](at);
      if (remaining === null) return;
      known = true;
      value += account.weight * remaining;
    });
    if (known) points.push({ at, value });
  }
  if (points.length > 0 || pool.accounts.some((account) => account.samples.length > 0)) {
    points.push({ at: now, value: poolRemaining(pool) });
  }
  return points;
}

function mergeResets(marks: ResetMark[]): ResetMark[] {
  const merged: ResetMark[] = [];
  for (const mark of [...marks].sort(byAt)) {
    const last = merged[merged.length - 1];
    if (last && mark.at - last.at <= RESET_MERGE_MS) {
      last.gain += mark.gain;
    } else {
      merged.push({ ...mark });
    }
  }
  return merged;
}

/** Resets seen in the recorded history: a reading that rose by a meaningful amount. */
export function recordedResets(pool: Pool, from: number, now: number): ResetMark[] {
  const marks: ResetMark[] = [];
  for (const account of pool.accounts) {
    for (let index = 1; index < account.samples.length; index += 1) {
      const previous = account.samples[index - 1];
      const sample = account.samples[index];
      if (sample.at < from || sample.at > now) continue;
      const rise = sample.remaining - previous.remaining;
      if (rise >= RESET_MIN_RISE) marks.push({ at: sample.at, gain: account.weight * rise });
    }
  }
  return mergeResets(marks);
}

/**
 * Quota used inside [from, to], in the account's own percent. Only drops count, so a reset
 * inside the span does not cancel the use before it; a pair of readings straddling `from`
 * counts the share of its drop that falls inside the span.
 */
export function consumedBetween(samples: QuotaSample[], from: number, to: number): number {
  let used = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const sample = samples[index];
    if (sample.at <= from || previous.at >= to) continue;
    const drop = previous.remaining - sample.remaining;
    if (drop <= 0) continue;
    const span = sample.at - previous.at;
    const inside = Math.min(sample.at, to) - Math.max(previous.at, from);
    used += span > 0 ? (drop * inside) / span : drop;
  }
  return used;
}

export interface BurnRates {
  /** Pool percent per hour, or null when no account has readings that cover the span. */
  pool: number | null;
  /** Pool percent per hour each account contributed. */
  byAccount: Map<string, number>;
}

/** Readings shorter than this cannot give a rate. */
const MIN_RATE_SPAN_MS = HOUR_MS;

/**
 * Average use over the trailing span, idle time included. An account whose readings start
 * inside the span is averaged over the part it covers, so a newly added credential is not
 * diluted by hours it did not exist.
 */
export function burnRates(pool: Pool, spanMs: number, now: number): BurnRates {
  const start = now - spanMs;
  const byAccount = new Map<string, number>();
  let total = 0;
  let covered = false;
  for (const account of pool.accounts) {
    // Prefer full-resolution readings when they reach back far enough.
    const samples =
      account.recentSamples.length > 1 && account.recentSamples[0].at <= start
        ? account.recentSamples
        : account.samples;
    if (samples.length < 2 || samples[samples.length - 1].at <= start) continue;
    const from = Math.max(start, samples[0].at);
    if (now - from < Math.min(spanMs, MIN_RATE_SPAN_MS)) continue;
    covered = true;
    const rate = (account.weight * consumedBetween(samples, from, now)) / ((now - from) / HOUR_MS);
    byAccount.set(account.authIndex, rate);
    total += rate;
  }
  return { pool: covered ? total : null, byAccount };
}

/**
 * Recorded drain on a grid: pool percent used per hour over the trailing span.
 *
 * Use is spread once into grid cells, then each point sums the cells of its trailing span,
 * so a long range costs one pass over the readings instead of one per point.
 */
export function recordedDrain(
  pool: Pool,
  from: number,
  now: number,
  stepMs: number,
  spanMs: number
): ChartPoint[] {
  const reported = pool.accounts.filter((account) => account.samples.length > 1);
  if (reported.length === 0 || !(stepMs > 0) || now < from) return [];
  const spanCells = Math.max(1, Math.round(spanMs / stepMs));
  const base = from - spanCells * stepMs;
  const cellCount = Math.ceil((now - base) / stepMs) + 1;
  const cells = new Float64Array(cellCount);
  const cellOf = (at: number) => Math.floor((at - base) / stepMs);

  for (const account of reported) {
    for (let index = 1; index < account.samples.length; index += 1) {
      const previous = account.samples[index - 1];
      const sample = account.samples[index];
      const drop = previous.remaining - sample.remaining;
      if (drop <= 0 || sample.at <= base || previous.at >= now) continue;
      const start = Math.max(previous.at, base);
      const end = Math.min(sample.at, now);
      const span = sample.at - previous.at;
      // Spread the drop evenly over the cells the pair of readings covers.
      for (let cell = cellOf(start); cell <= cellOf(end) && cell < cellCount; cell += 1) {
        const cellStart = base + cell * stepMs;
        const overlap = Math.min(end, cellStart + stepMs) - Math.max(start, cellStart);
        if (overlap <= 0) continue;
        cells[cell] += span > 0 ? (account.weight * drop * overlap) / span : account.weight * drop;
      }
    }
  }

  const prefix = new Float64Array(cellCount + 1);
  cells.forEach((value, index) => {
    prefix[index + 1] = prefix[index] + value;
  });
  const hours = (spanCells * stepMs) / HOUR_MS;
  const points: ChartPoint[] = [];
  for (let at = from; at <= now; at += stepMs) {
    const end = Math.min(cellCount, cellOf(at));
    points.push({ at, value: (prefix[end] - prefix[Math.max(0, end - spanCells)]) / hours });
  }
  return points;
}

export interface ProjectionOptions {
  now: number;
  horizon: number;
  stepMs: number;
  /** Pool percent per hour each account is assumed to draw from now on. */
  shares: Map<string, number>;
}

export interface Projection {
  points: ChartPoint[];
  /** Pool percent per hour actually served, which falls when accounts run dry. */
  drain: ChartPoint[];
  resets: ResetMark[];
  firstEmpty: { at: number; account: PoolAccount } | null;
  poolEmpty: number | null;
  nextReset: ResetMark | null;
}

/**
 * Project the pool forward. Demand stays at the given per-account rates, and each account
 * keeps its share of it, as a pacing plugin or round-robin would route it. When an
 * account runs dry its share moves to the accounts that still have quota; when every
 * remaining account is idle, demand spreads by weight. Resets refill an account to 100% at
 * its reset time and repeat every period.
 */
export function projectPool(pool: Pool, options: ProjectionOptions): Projection {
  const { now, horizon, stepMs, shares } = options;
  const accounts = pool.accounts;
  const remaining = accounts.map((account) => account.remaining);
  const nextReset = accounts.map((account, index) => {
    let at = account.resetAt;
    if (at === null || at > now) return at;
    // A reset that passed without a new reading has still happened.
    remaining[index] = 100;
    if (pool.periodMs === null) return null;
    while (at <= now) at += pool.periodMs;
    return at;
  });
  const share = accounts.map((account) => Math.max(0, shares.get(account.authIndex) ?? 0));
  const demand = share.reduce((sum, value) => sum + value, 0);

  const total = () =>
    accounts.reduce((sum, account, index) => sum + account.weight * remaining[index], 0);
  const points: ChartPoint[] = [{ at: now, value: total() }];
  const drain: ChartPoint[] = [{ at: now, value: demand }];
  const resets: ResetMark[] = [];
  let firstEmpty: Projection['firstEmpty'] = null;
  let poolEmpty: number | null = total() <= 0 ? now : null;

  const burn = (from: number, to: number) => {
    const hours = (to - from) / HOUR_MS;
    if (hours <= 0 || demand <= 0) return 0;
    const live = accounts.map((_, index) => remaining[index] > 0);
    const liveShare = share.reduce((sum, value, index) => sum + (live[index] ? value : 0), 0);
    const liveWeight = accounts.reduce(
      (sum, account, index) => sum + (live[index] ? account.weight : 0),
      0
    );
    if (liveWeight === 0) return 0;
    let served = 0;
    let lastCrossing = from;
    accounts.forEach((account, index) => {
      if (!live[index]) return;
      const draw =
        liveShare > 0
          ? (demand * share[index]) / liveShare
          : (demand * account.weight) / liveWeight;
      const perHour = draw / account.weight;
      const drop = perHour * hours;
      if (drop >= remaining[index]) {
        const crossing = from + (remaining[index] / perHour) * HOUR_MS;
        served += account.weight * remaining[index];
        remaining[index] = 0;
        lastCrossing = Math.max(lastCrossing, crossing);
        if (!firstEmpty || crossing < firstEmpty.at) firstEmpty = { at: crossing, account };
      } else {
        served += account.weight * drop;
        remaining[index] -= drop;
      }
    });
    // Demand an account could not take after running dry moves to those still holding quota.
    const unserved = demand * hours - served;
    const holderWeight = accounts.reduce(
      (sum, account, index) => sum + (remaining[index] > 0 ? account.weight : 0),
      0
    );
    if (unserved > 1e-9 && holderWeight > 0) {
      // Spread by weight: each holder drops by the same share of its own quota.
      const drop = unserved / holderWeight;
      accounts.forEach((account, index) => {
        if (remaining[index] <= 0) return;
        const take = Math.min(remaining[index], drop);
        remaining[index] -= take;
        served += take * account.weight;
      });
    }
    if (poolEmpty === null && remaining.every((value) => value <= 0)) poolEmpty = lastCrossing;
    return served / hours;
  };

  for (let at = now; at < horizon;) {
    const stepEnd = Math.min(at + stepMs, horizon);
    // Split the step at every reset inside it so jumps land on their exact instant.
    const boundaries = [
      ...new Set(nextReset.filter((value): value is number => value !== null && value <= stepEnd)),
    ].sort((a, b) => a - b);
    let cursor = at;
    let servedPerHour = 0;
    for (const boundary of boundaries) {
      servedPerHour = burn(cursor, boundary);
      points.push({ at: boundary, value: total() });
      let gain = 0;
      accounts.forEach((account, index) => {
        if (nextReset[index] !== boundary) return;
        gain += account.weight * (100 - remaining[index]);
        remaining[index] = 100;
        nextReset[index] = pool.periodMs === null ? null : boundary + pool.periodMs;
      });
      if (gain >= 0.5) resets.push({ at: boundary, gain });
      points.push({ at: boundary, value: total() });
      cursor = boundary;
    }
    servedPerHour = cursor < stepEnd ? burn(cursor, stepEnd) : servedPerHour;
    points.push({ at: stepEnd, value: total() });
    drain.push({ at: stepEnd, value: servedPerHour });
    at = stepEnd;
  }

  const merged = mergeResets(resets);
  return {
    points,
    drain,
    resets: merged,
    firstEmpty,
    poolEmpty,
    nextReset: merged[0] ?? null,
  };
}
