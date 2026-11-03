import {
  BURN_SPANS,
  FUTURE_USAGE,
  POOL_METRICS,
  QUOTA_TAB_ORDER,
  type BurnSpanId,
  type FutureUsageId,
  type PoolMetricId,
  type QuotaTabId,
} from './constants';

/** Quota page preferences, kept for the browser session (sessionStorage). */
export type QuotaUiState = {
  tab?: QuotaTabId;
  metric?: PoolMetricId;
  burnSpan?: BurnSpanId;
  future?: FutureUsageId;
  showAccounts?: boolean;
};

const QUOTA_UI_STATE_KEY = 'quotaPage.uiState';

const QUOTA_TAB_ID_SET = new Set<string>(['all', ...QUOTA_TAB_ORDER]);

export const isQuotaTabId = (value: unknown): value is QuotaTabId =>
  typeof value === 'string' && QUOTA_TAB_ID_SET.has(value);

const oneOf = <T extends string>(choices: readonly T[], value: unknown): T | undefined =>
  choices.find((choice) => choice === value);

export const readQuotaUiState = (): QuotaUiState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(QUOTA_UI_STATE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const stored = parsed as Record<string, unknown>;
    return {
      tab: isQuotaTabId(stored.tab) ? stored.tab : undefined,
      metric: oneOf(POOL_METRICS, stored.metric),
      burnSpan: oneOf(Object.keys(BURN_SPANS) as BurnSpanId[], stored.burnSpan),
      future: oneOf(Object.keys(FUTURE_USAGE) as FutureUsageId[], stored.future),
      showAccounts: typeof stored.showAccounts === 'boolean' ? stored.showAccounts : undefined,
    };
  } catch {
    return null;
  }
};

/**
 * Merge into whatever is already stored.
 *
 * Each control writes one preference and knows nothing about the others, so a whole-object
 * write would silently drop the other fields every time one changed.
 */
export const writeQuotaUiState = (state: QuotaUiState) => {
  if (typeof window === 'undefined') return;
  try {
    const next = { ...readQuotaUiState(), ...state };
    window.sessionStorage.setItem(QUOTA_UI_STATE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable (private mode); preferences then last for the visit only.
  }
};
