import type { QuotaProviderType } from './providers/types';

/**
 * Providers the quota page shows, in tab order. Other built-in quota providers still power
 * the credential cards on the Auth Files page; this page leaves them out on purpose.
 */
export const QUOTA_TAB_ORDER = [
  'claude',
  'codex',
  'plugin',
] as const satisfies readonly QuotaProviderType[];

export type QuotaPageProvider = (typeof QUOTA_TAB_ORDER)[number];
export type QuotaTabId = 'all' | QuotaPageProvider;

/** 与 useRevealGroup 的 GROUP_MAX_TOTAL 一致：卡片级联总预算 360ms。 */
export const CARD_ENTRANCE_BUDGET_MS = 360;

/** Chart metric: the pool's remaining quota, or how fast it is used. */
export const POOL_METRICS = ['remaining', 'drain'] as const;
export type PoolMetricId = (typeof POOL_METRICS)[number];

/** Spans a burn rate is measured over. */
export const BURN_SPANS = { '1h': 1, '3h': 3, '6h': 6 } as const;
export type BurnSpanId = keyof typeof BURN_SPANS;

/** Future demand as a multiple of today's burn rate. */
export const FUTURE_USAGE = { idle: 0, half: 0.5, same: 1, more: 1.5, double: 2 } as const;
export type FutureUsageId = keyof typeof FUTURE_USAGE;
