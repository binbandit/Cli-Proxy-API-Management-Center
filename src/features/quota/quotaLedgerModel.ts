import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
  XaiQuotaState,
} from '@/types';
import type { QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';

export interface LedgerWindow {
  id: string;
  label: string;
  remaining: number | null;
  resetAtMs: number | null;
  periodHours: number | null;
}

const percent = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
const remaining = (used: number | null | undefined) =>
  typeof used === 'number' ? percent(100 - used) : null;
const instant = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Present the same observations as the provider cards; missing values stay unknown. */
export function ledgerWindows(
  type: QuotaProviderType,
  quota: QuotaCardState | undefined,
  t: TFunction
): LedgerWindow[] {
  if (!quota || (quota.status !== 'success' && type !== 'claude')) return [];
  if (type === 'claude' || type === 'codex') {
    return (quota as ClaudeQuotaState | CodexQuotaState).windows.map((row) => ({
      id: row.id,
      label: row.labelKey
        ? t(row.labelKey, ('labelParams' in row ? row.labelParams : {}) ?? {})
        : row.label,
      remaining: remaining(row.usedPercent),
      resetAtMs: instant(row.resetAtMs),
      periodHours: row.periodHours ?? null,
    }));
  }
  if (type === 'antigravity' || type === 'plugin') {
    return (quota as AntigravityQuotaState).groups.flatMap((group) =>
      group.buckets.map((row) => ({
        id: `${group.id}:${row.id}`,
        label: row.label,
        remaining: percent(row.remainingFraction * 100),
        resetAtMs: instant(row.resetAtMs),
        periodHours: row.periodHours ?? null,
      }))
    );
  }
  if (type === 'kimi') {
    return (quota as KimiQuotaState).rows.map((row) => ({
      id: row.id,
      label: row.labelKey ? t(row.labelKey, row.labelParams ?? {}) : (row.label ?? ''),
      remaining:
        row.limit > 0
          ? percent(((row.limit - row.used) / row.limit) * 100)
          : row.used > 0
            ? 0
            : null,
      resetAtMs: instant(row.resetAtMs),
      periodHours: row.periodHours ?? null,
    }));
  }
  if (type === 'devin') {
    return (quota as DevinQuotaState).windows.map((row) => ({
      id: row.id,
      label: row.label ?? t(`devin_quota.${row.id}`),
      remaining: percent(row.remainingPercent),
      resetAtMs: instant(row.resetAtMs),
      periodHours: row.periodHours,
    }));
  }
  if (type === 'meta') {
    return ((quota as MetaQuotaState).data?.windows ?? []).map((row) => ({
      id: row.id,
      label: t(`meta_quota.${row.id}`),
      remaining: remaining(row.usedPercent),
      resetAtMs: instant(row.resetAt === undefined ? null : row.resetAt * 1000),
      periodHours: row.id === 'weekly' ? 168 : (row.durationMinutes ?? 0) / 60,
    }));
  }
  const billing = (quota as XaiQuotaState).billing;
  // Monthly spend caps and on-demand balances are not weekly quota capacity.
  if (!billing || billing.periodType !== 'weekly') return [];
  return [
    {
      id: 'weekly',
      label: t('quota_management.ledger_weekly'),
      remaining: remaining(billing.usagePercent),
      resetAtMs: instant(billing.resetAtMs),
      periodHours: billing.periodHours ?? 168,
    },
  ];
}

/** Sum one common window across accounts. Never mix model scopes or durations. */
export function summarizeLedgerWindows(accounts: LedgerWindow[][]) {
  const candidates = new Map<string, { window: LedgerWindow; values: LedgerWindow[] }>();
  for (const windows of accounts) {
    const seen = new Set<string>();
    for (const window of windows) {
      const key = `${window.id}:${window.periodHours}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const candidate = candidates.get(key) ?? { window, values: [] };
      candidate.values.push(window);
      candidates.set(key, candidate);
    }
  }
  const selected = [...candidates.values()].sort((a, b) => {
    const priority = (row: LedgerWindow) =>
      ['weekly', 'seven_day', 'seven-day'].includes(row.id) ? 2 : row.periodHours === 168 ? 1 : 0;
    return priority(b.window) - priority(a.window) || b.values.length - a.values.length;
  })[0];
  if (!selected) return null;
  const known = selected.values.filter((row) => row.remaining !== null);
  return {
    label: selected.window.label,
    values: selected.values,
    total: known.length ? known.reduce((sum, row) => sum + row.remaining!, 0) : null,
    capacity: known.length * 100,
    loaded: known.length,
    resetAtMs: selected.values.reduce<number | null>(
      (earliest, row) =>
        row.resetAtMs === null ? earliest : Math.min(earliest ?? Infinity, row.resetAtMs),
      null
    ),
  };
}

export function maskQuotaEmail(name: string): string {
  return name.replace(
    /([\p{L}\p{N}._%+-]+)@([\p{L}\p{N}.-]+)/gu,
    (_match, local: string, domain: string) => {
      const prefix = local.match(/^(claude|codex|kimi|xai|antigravity|devin|meta)-/i)?.[0] ?? '';
      const account = local.slice(prefix.length);
      const extension = domain.endsWith('.json') ? '.json' : '';
      return `${prefix}${account.slice(0, 1)}•••@${domain.slice(0, 1)}•••${extension}`;
    }
  );
}
