/**
 * Lamplighter plugin routes: recorded quota readings for every account on the proxy.
 *
 * The plugin is optional. A missing plugin answers 404, which callers treat as "no recorder"
 * rather than an error. See https://github.com/PosvdM/cpa-plugin-lamplighter.
 */

import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';
import type {
  LamplighterAccount,
  LamplighterGroup,
  LamplighterHistory,
  LamplighterRange,
  LamplighterReadiness,
  LamplighterSeries,
  LamplighterStatus,
  LamplighterWindow,
  QuotaSample,
  QuotaWindowKind,
} from '@/types';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const percent = (value: unknown): number => Math.max(0, Math.min(100, finite(value) ?? 0));

// Go encodes an unset time.Time as year 1 even with omitempty, so anything before 2001
// is treated as unknown rather than as a real instant.
const EARLIEST_INSTANT = Date.UTC(2001, 0, 1);

export const parseInstant = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms >= EARLIEST_INSTANT ? ms : null;
};

const windowKind = (value: unknown): QuotaWindowKind =>
  value === '5h' || value === '7d' ? value : 'other';

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const normalizeWindow = (raw: unknown): LamplighterWindow | null => {
  if (!isRecord(raw) || !text(raw.id)) return null;
  return {
    id: text(raw.id),
    label: text(raw.short) || text(raw.label) || text(raw.id),
    kind: windowKind(raw.kind),
    remaining: percent(raw.remaining),
    resetAt: parseInstant(raw.reset),
    observedAt: parseInstant(raw.observed_at),
  };
};

const normalizeGroup = (raw: unknown): LamplighterGroup | null => {
  if (!isRecord(raw) || !text(raw.key)) return null;
  return {
    key: text(raw.key),
    sourceLabel: text(raw.source_label) || text(raw.label),
    windows: list(raw.windows).flatMap((item) => normalizeWindow(item) ?? []),
  };
};

const normalizeAccount = (raw: unknown): LamplighterAccount | null => {
  if (!isRecord(raw) || !text(raw.auth_index)) return null;
  const weight = finite(raw.default_weight);
  return {
    authIndex: text(raw.auth_index),
    provider: text(raw.provider),
    title: text(raw.title),
    email: text(raw.email),
    plan: text(raw.plan),
    defaultWeight: weight !== null && weight > 0 ? weight : 1,
    unavailable: raw.unavailable === true,
    error: text(raw.error),
    groups: list(raw.groups).flatMap((item) => normalizeGroup(item) ?? []),
  };
};

const normalizeWeights = (raw: unknown): Record<string, number> => {
  if (!isRecord(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).flatMap(([name, value]) => {
      const weight = finite(value);
      return weight !== null && weight > 0 ? [[name, weight]] : [];
    })
  );
};

export function normalizeLamplighterStatus(raw: unknown): LamplighterStatus {
  const data = isRecord(raw) ? raw : {};
  const config = isRecord(data.config) ? data.config : {};
  return {
    version: text(data.version),
    running: data.running === true,
    enabled: data.enabled === true,
    configError: text(data.config_error),
    lockError: text(data.lock_error),
    now: parseInstant(data.now) ?? Date.now(),
    lastPoll: parseInstant(data.last_poll),
    nextPoll: parseInstant(data.next_poll),
    accountWeights: normalizeWeights(config.account_weights),
    groupOrder: list(data.group_order).map(text).filter(Boolean),
    accounts: list(data.accounts).flatMap((item) => normalizeAccount(item) ?? []),
  };
}

/**
 * Lamplighter answers actions such as a sync with 503 until its loop runs; status and
 * history keep answering. The flags say which of the reasons applies.
 */
export function lamplighterReadiness(status: LamplighterStatus): LamplighterReadiness {
  if (!status.enabled) return 'disabled';
  if (status.running) return 'ready';
  if (status.configError) return 'config';
  if (status.lockError) return 'waiting';
  return 'starting';
}

/** Points arrive as `[unix seconds, remaining, passive flag]`. */
const normalizeSample = (raw: unknown): QuotaSample | null => {
  if (!Array.isArray(raw)) return null;
  const seconds = finite(raw[0]);
  const remaining = finite(raw[1]);
  if (seconds === null || remaining === null) return null;
  return { at: seconds * 1000, remaining: Math.max(0, Math.min(100, remaining)) };
};

const normalizeSeries = (raw: unknown): LamplighterSeries | null => {
  if (!isRecord(raw) || !text(raw.group) || !text(raw.auth_index)) return null;
  return {
    groupKey: text(raw.group),
    windowId: text(raw.window),
    kind: windowKind(raw.kind),
    sourceLabel: text(raw.source_label),
    provider: text(raw.provider),
    authIndex: text(raw.auth_index),
    samples: list(raw.points)
      .flatMap((item) => normalizeSample(item) ?? [])
      .sort((a, b) => a.at - b.at),
  };
};

export function normalizeLamplighterHistory(raw: unknown): LamplighterHistory {
  const data = isRecord(raw) ? raw : {};
  return {
    from: parseInstant(data.from) ?? 0,
    to: parseInstant(data.to) ?? 0,
    series: list(data.series).flatMap((item) => normalizeSeries(item) ?? []),
  };
}

export const lamplighterApi = {
  async status(): Promise<LamplighterStatus> {
    return normalizeLamplighterStatus(
      await apiClient.get(apiClient.pluginRouteUrl('lamplighter/status'))
    );
  },

  async history(range: LamplighterRange): Promise<LamplighterHistory> {
    const raw = await apiClient.get(apiClient.pluginRouteUrl('lamplighter/history'), {
      params: { range },
    });
    return normalizeLamplighterHistory(raw);
  },

  /** Ask the plugin to read every account now. Upstream failures land on each account. */
  async refreshAll(): Promise<void> {
    await apiClient.post(apiClient.pluginRouteUrl('lamplighter/refresh'), {});
  },
};
