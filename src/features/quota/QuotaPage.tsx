/**
 * Quota page: one chart per quota pool, built from the Lamplighter plugin's readings.
 *
 * Opening the page never calls a provider. Lamplighter reads every account in the
 * background and from live traffic, and the page polls its stored readings. Accounts the
 * plugin does not track (Devin, Meta, plugin quotas, or every account when the plugin is
 * missing) keep the per-account rows, which call the provider only when asked.
 *
 * Kept from the previous page: the cacheGeneration session guard with request-id dedupe,
 * pruning quota caches when credentials disappear, and the single header-refresh slot.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { authFilesApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconChevronLeft, IconChevronRight } from '@/components/ui/icons';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNow } from '@/hooks/useNow';
import { useRevealGroup } from '@/hooks/motion';
import { useAuthStore, useNotificationStore, useQuotaStore, useThemeStore } from '@/stores';
import type { AuthFileItem, LamplighterAccount, LamplighterRange, ResolvedTheme } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { getQuotaCacheKey, getQuotaDisplayName } from '@/utils/quota/identity';
import { normalizeProviderId } from '@/utils/quota/validators';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';
import { ProviderTabs } from '@/features/authFiles/components/ProviderTabs';
import { QuotaHeader } from './components/QuotaHeader';
import { QuotaLedgerGroupHeading, QuotaLedgerRow } from './components/QuotaLedger';
import { maskQuotaEmail, type LedgerWindow } from './quotaLedgerModel';
import {
  BURN_SPANS,
  FUTURE_USAGE,
  QUOTA_TAB_ORDER,
  type BurnSpanId,
  type FutureUsageId,
  type PoolMetricId,
  type QuotaPageProvider,
  type QuotaTabId,
} from './constants';
import {
  buildTabCounts,
  classifyQuotaFiles,
  filterEntriesByTab,
  type QuotaFileEntry,
} from './logic';
import { QUOTA_ADAPTERS, getQuotaSetter, type QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';
import { useQuotaActions } from './hooks/useQuotaActions';
import { useQuotaBatchLoader } from './hooks/useQuotaBatchLoader';
import { readQuotaUiState, writeQuotaUiState } from './uiState';
import { buildPools } from './pool/poolModel';
import { PoolCard } from './pool/PoolCard';
import { formatDate, formatDuration, shiftDays, startOfLocalDay } from './pool/poolFormat';
import { useLamplighter } from './pool/useLamplighter';
import styles from './QuotaPage.module.scss';

const BURN_SPAN_IDS = Object.keys(BURN_SPANS) as BurnSpanId[];
const FUTURE_USAGE_IDS = Object.keys(FUTURE_USAGE) as FutureUsageId[];
/** The chart shows two weeks: three days back and the rest ahead. */
const VIEW_DAYS = 14;
const VIEW_LEAD_DAYS = 3;
/** Lamplighter keeps about five weeks of history, so the view pages back four weeks. */
const MIN_WEEK_OFFSET = -4;
const MAX_WEEK_OFFSET = 1;

/** Smallest stored range that reaches back to `start`. */
function historyRangeFor(lookbackMs: number): LamplighterRange {
  if (lookbackMs <= 4 * DAY_MS) return '4d';
  if (lookbackMs <= 8 * DAY_MS) return '8d';
  if (lookbackMs <= 15 * DAY_MS) return '15d';
  return '36d';
}

const authIndexOf = (file: AuthFileItem) =>
  normalizeAuthIndex(file['auth_index'] ?? file.authIndex);

const isPageProvider = (provider: string): provider is QuotaPageProvider =>
  QUOTA_TAB_ORDER.some((type) => type === provider);

export function QuotaPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const navigate = useNavigate();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const disableControls = connectionStatus !== 'connected';
  const revealRef = useRevealGroup<HTMLDivElement>();

  const [saved] = useState(() => readQuotaUiState() ?? {});
  const [tab, setTab] = useState<QuotaTabId>(saved.tab ?? 'all');
  const [metric, setMetric] = useState<PoolMetricId>(saved.metric ?? 'remaining');
  const [burnSpan, setBurnSpan] = useState<BurnSpanId>(saved.burnSpan ?? '3h');
  const [future, setFuture] = useState<FutureUsageId>(saved.future ?? 'same');
  const [showAccounts, setShowAccounts] = useState(saved.showAccounts ?? false);
  const [showEmails, setShowEmails] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);

  /* ---------- Credential list ---------- */

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState('');
  const sessionGeneration = useQuotaStore((state) => state.cacheGeneration);
  const [filesGeneration, setFilesGeneration] = useState<number | null>(null);
  const listRequestRef = useRef(0);

  const loadFiles = useCallback(async () => {
    const requestId = ++listRequestRef.current;
    if (connectionStatus !== 'connected') {
      setFiles([]);
      setFilesGeneration(null);
      setFilesLoading(false);
      return;
    }
    const isCurrent = () =>
      requestId === listRequestRef.current &&
      sessionGeneration === useQuotaStore.getState().cacheGeneration;
    setFilesLoading(true);
    setFilesError('');
    try {
      const data = await authFilesApi.list();
      if (!isCurrent()) return;
      setFiles(data?.files || []);
      setFilesGeneration(sessionGeneration);
    } catch (err: unknown) {
      if (!isCurrent()) return;
      setFilesError(err instanceof Error ? err.message : t('notification.refresh_failed'));
    } finally {
      if (isCurrent()) setFilesLoading(false);
    }
  }, [connectionStatus, sessionGeneration, t]);

  useEffect(() => {
    void loadFiles();
    return () => {
      listRequestRef.current += 1;
    };
  }, [loadFiles]);

  /* ---------- Lamplighter readings ---------- */

  const now = useNow();
  const viewStart = shiftDays(startOfLocalDay(shiftDays(now, -VIEW_LEAD_DAYS)), weekOffset * 7);
  const viewEnd = shiftDays(viewStart, VIEW_DAYS);
  const { feed, syncing, syncNow, reload } = useLamplighter(
    historyRangeFor(now - viewStart),
    !disableControls
  );

  const refreshEverything = useCallback(() => {
    void loadFiles();
    void reload();
  }, [loadFiles, reload]);
  useHeaderRefresh(refreshEverything);

  /* ---------- Per-account quota cache (rows the user expands or refreshes) ---------- */

  const antigravityQuota = useQuotaStore((state) => state.antigravityQuota);
  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const devinQuota = useQuotaStore((state) => state.devinQuota);
  const kimiQuota = useQuotaStore((state) => state.kimiQuota);
  const metaQuota = useQuotaStore((state) => state.metaQuota);
  const pluginQuota = useQuotaStore((state) => state.pluginQuota);
  const xaiQuota = useQuotaStore((state) => state.xaiQuota);
  const quotaByType = useMemo(
    () =>
      ({
        antigravity: antigravityQuota,
        claude: claudeQuota,
        codex: codexQuota,
        devin: devinQuota,
        kimi: kimiQuota,
        meta: metaQuota,
        plugin: pluginQuota,
        xai: xaiQuota,
      }) as unknown as Record<QuotaProviderType, Record<string, QuotaCardState>>,
    [
      antigravityQuota,
      claudeQuota,
      codexQuota,
      devinQuota,
      kimiQuota,
      metaQuota,
      pluginQuota,
      xaiQuota,
    ]
  );
  const getQuota = useCallback(
    (entry: QuotaFileEntry): QuotaCardState | undefined =>
      quotaByType[entry.type][getQuotaCacheKey(entry.file)],
    [quotaByType]
  );

  const entries = useMemo(() => classifyQuotaFiles(files), [files]);
  const tabCounts = useMemo(() => buildTabCounts(entries), [entries]);
  const tabEntries = useMemo(() => filterEntriesByTab(entries, tab), [entries, tab]);
  // Plugin quotas are not a provider of their own; their tab appears only when one exists.
  const tabIds = [
    'all',
    ...QUOTA_TAB_ORDER.filter((type) => type !== 'plugin' || tabCounts.plugin > 0),
  ];
  const entryByIndex = useMemo(
    () =>
      new Map(
        entries.flatMap((entry) => {
          const index = authIndexOf(entry.file);
          return index ? [[index, entry] as const] : [];
        })
      ),
    [entries]
  );

  // Drop cached quota of credentials that no longer exist once the list has settled.
  useEffect(() => {
    if (filesLoading || filesError || filesGeneration !== sessionGeneration) return;
    const survivorsByType = new Map<QuotaProviderType, Set<string>>(
      QUOTA_TAB_ORDER.map((type) => [type, new Set<string>()])
    );
    entries.forEach((entry) => survivorsByType.get(entry.type)?.add(getQuotaCacheKey(entry.file)));
    QUOTA_TAB_ORDER.forEach((type) => {
      const survivors = survivorsByType.get(type) ?? new Set<string>();
      getQuotaSetter(QUOTA_ADAPTERS[type])((prev) => {
        const staleKeys = Object.keys(prev).filter((name) => !survivors.has(name));
        if (staleKeys.length === 0) return prev;
        const next = { ...prev };
        staleKeys.forEach((name) => delete next[name]);
        return next;
      });
    });
  }, [entries, filesError, filesGeneration, filesLoading, sessionGeneration]);

  const displayNameFor = useCallback(
    (name: string) => (showEmails ? name : maskQuotaEmail(name)),
    [showEmails]
  );
  const { batchLoading, loadQuota } = useQuotaBatchLoader();
  const { resettingQuotaName, refreshQuota, resetQuota } = useQuotaActions(
    disableControls,
    displayNameFor
  );
  const canUseActions = !disableControls && !filesLoading && filesGeneration === sessionGeneration;

  /* ---------- Pools ---------- */

  const ready = feed.phase === 'ready' ? feed : null;
  const fileNameByIndex = useMemo(
    () => new Map(entries.map((entry) => [authIndexOf(entry.file) ?? '', entry.file.name])),
    [entries]
  );
  const trackedAccounts = useMemo(
    () => new Map((ready?.status.accounts ?? []).map((account) => [account.authIndex, account])),
    [ready]
  );
  const pools = useMemo(() => {
    if (!ready) return [];
    const weightOf = (account: LamplighterAccount) =>
      ready.status.accountWeights[fileNameByIndex.get(account.authIndex) ?? ''] ??
      account.defaultWeight;
    return buildPools({
      status: ready.status,
      history: ready.history,
      recent: ready.recent,
      weightOf,
    });
  }, [ready, fileNameByIndex]);
  const visiblePools = pools.filter((pool) => {
    const provider = normalizeProviderId(pool.provider);
    return isPageProvider(provider) && (tab === 'all' || provider === tab);
  });

  // Rows without a pool: everything the plugin does not track, or all rows without it.
  const untrackedEntries = useMemo(
    () =>
      feed.phase === 'loading'
        ? []
        : tabEntries.filter((entry) => !trackedAccounts.has(authIndexOf(entry.file) ?? '')),
    [feed.phase, tabEntries, trackedAccounts]
  );

  /* ---------- Rows ---------- */

  const accountNote = (account: LamplighterAccount | undefined, observedAt: number | null) => {
    if (!account) return undefined;
    if (account.error) {
      return (
        <span className={styles.readFailed} title={account.error}>
          {t('quota_management.account_read_failed', { error: account.error })}
        </span>
      );
    }
    if (!observedAt) return undefined;
    return now - observedAt < 60_000
      ? t('quota_management.account_read_now')
      : t('quota_management.account_read_ago', { time: formatDuration(now - observedAt) });
  };

  const recordedWindows = (account: LamplighterAccount | undefined, sourceLabel: string) =>
    account?.groups
      .find((group) => group.sourceLabel === sourceLabel)
      ?.windows.map((window): LedgerWindow => ({
        id: window.id,
        label:
          window.kind === 'other'
            ? window.label
            : t(window.kind === '5h' ? 'quota_management.window_5h' : 'quota_management.window_7d'),
        remaining: window.remaining,
        resetAtMs: window.resetAt,
        periodHours: window.kind === '5h' ? 5 : window.kind === '7d' ? 168 : null,
      })) ?? [];

  const renderRow = (
    entry: QuotaFileEntry,
    extra?: { windows: LedgerWindow[]; note: ReactNode }
  ) => (
    <QuotaLedgerRow
      key={`${entry.type}:${getQuotaCacheKey(entry.file)}`}
      entry={entry}
      quota={getQuota(entry)}
      resolvedTheme={resolvedTheme}
      canRefresh={canUseActions && !entry.file.disabled}
      resetting={resettingQuotaName === getQuotaCacheKey(entry.file)}
      entranceDelayMs={null}
      displayName={displayNameFor(getQuotaDisplayName(entry.file))}
      showEmails={showEmails}
      recordedWindows={extra?.windows}
      recordedNote={extra?.note}
      onRefresh={() => void refreshQuota(entry.file, QUOTA_ADAPTERS[entry.type])}
      onReset={() => resetQuota(entry.file, QUOTA_ADAPTERS[entry.type])}
    />
  );

  /* ---------- Header action ---------- */

  const trackedCount = entries.filter((entry) =>
    trackedAccounts.has(authIndexOf(entry.file) ?? '')
  ).length;
  const loadedCount = entries.filter((entry) => getQuota(entry)?.status === 'success').length;

  const handleSync = () => {
    syncNow().catch((err: unknown) =>
      showNotification(
        t('quota_management.sync_failed', {
          message: err instanceof Error ? err.message : String(err),
        }),
        'error'
      )
    );
  };

  const settings = {
    metric,
    burnSpanMs: BURN_SPANS[burnSpan] * HOUR_MS,
    demandScale: FUTURE_USAGE[future],
    viewStart,
    viewEnd,
    now,
  };

  const accountName = (authIndex: string) => {
    const account = trackedAccounts.get(authIndex);
    if (!account) return authIndex;
    return showEmails && account.email ? account.email : account.title;
  };

  const loading = filesLoading || feed.phase === 'loading';
  const isEmpty = !loading && tabEntries.length === 0;

  return (
    <div className={styles.page} ref={revealRef}>
      <QuotaHeader
        totalCount={entries.length}
        detail={
          ready
            ? t('quota_management.meta_tracked', { count: trackedCount })
            : loadedCount > 0
              ? t('quota_management.meta_loaded', { count: loadedCount })
              : undefined
        }
        showEmails={showEmails}
        onToggleEmails={() => setShowEmails((shown) => !shown)}
        {...(ready
          ? {
              actionLabel: t('quota_management.sync_now'),
              actionTitle: t('quota_management.sync_now_hint'),
              busy: syncing,
              disabled: disableControls,
              onAction: handleSync,
            }
          : {
              actionLabel: t('quota_management.refresh_all_credentials'),
              busy: batchLoading,
              disabled: disableControls || loading || untrackedEntries.length === 0,
              onAction: () => void loadQuota(untrackedEntries),
            })}
      />

      <section className={styles.workbench}>
        <div className={styles.tabsRow} data-reveal>
          <ProviderTabs
            types={tabIds}
            counts={tabCounts}
            active={tab}
            resolvedTheme={resolvedTheme}
            onChange={(next) => {
              setTab(next as QuotaTabId);
              writeQuotaUiState({ tab: next as QuotaTabId });
            }}
          />
        </div>

        {ready && visiblePools.length > 0 && (
          <div className={styles.controls}>
            <SegmentedControl
              value={metric}
              ariaLabel={t('quota_management.metric_label')}
              options={[
                { value: 'remaining', label: t('quota_management.metric_remaining') },
                { value: 'drain', label: t('quota_management.metric_drain') },
              ]}
              onChange={(value) => {
                setMetric(value);
                writeQuotaUiState({ metric: value });
              }}
            />
            <div className={styles.controlGroup}>
              <span className={styles.controlLabel}>{t('quota_management.burn_label')}</span>
              <SegmentedControl
                value={burnSpan}
                ariaLabel={t('quota_management.burn_label')}
                options={BURN_SPAN_IDS.map((value) => ({ value, label: value }))}
                onChange={(value) => {
                  setBurnSpan(value);
                  writeQuotaUiState({ burnSpan: value });
                }}
              />
            </div>
            <div className={styles.controlGroup}>
              <span className={styles.controlLabel}>{t('quota_management.future_label')}</span>
              <Select
                className={styles.futureSelect}
                value={future}
                size="sm"
                fullWidth={false}
                ariaLabel={t('quota_management.future_label')}
                options={FUTURE_USAGE_IDS.map((value) => ({
                  value,
                  label: t(`quota_management.future_${value}`),
                }))}
                onChange={(value) => {
                  const next = FUTURE_USAGE_IDS.find((id) => id === value) ?? 'same';
                  setFuture(next);
                  writeQuotaUiState({ future: next });
                }}
              />
            </div>
            <button
              type="button"
              className={showAccounts ? `${styles.toggle} ${styles.toggleOn}` : styles.toggle}
              aria-pressed={showAccounts}
              onClick={() => {
                setShowAccounts(!showAccounts);
                writeQuotaUiState({ showAccounts: !showAccounts });
              }}
            >
              {t('quota_management.accounts_toggle')}
            </button>

            <div className={styles.rangeNav}>
              <span className={styles.rangeLabel}>
                {t('quota_management.range_label', {
                  from: formatDate(viewStart, locale),
                  to: formatDate(viewEnd - 1, locale),
                })}
              </span>
              <button
                type="button"
                className={styles.navButton}
                aria-label={t('quota_management.range_earlier')}
                disabled={weekOffset <= MIN_WEEK_OFFSET}
                onClick={() => setWeekOffset(weekOffset - 1)}
              >
                <IconChevronLeft size={16} />
              </button>
              <button
                type="button"
                className={weekOffset === 0 ? `${styles.toggle} ${styles.toggleOn}` : styles.toggle}
                aria-pressed={weekOffset === 0}
                onClick={() => setWeekOffset(0)}
              >
                {t('quota_management.range_today')}
              </button>
              <button
                type="button"
                className={styles.navButton}
                aria-label={t('quota_management.range_later')}
                disabled={weekOffset >= MAX_WEEK_OFFSET}
                onClick={() => setWeekOffset(weekOffset + 1)}
              >
                <IconChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {filesError && (
          <div className={styles.errorBanner} role="alert">
            {filesError}
          </div>
        )}
        {feed.phase === 'error' && (
          <div className={styles.errorBanner} role="alert">
            {t('quota_management.lamplighter_error', { message: feed.message })}
          </div>
        )}
        {ready?.pollError && (
          <div className={styles.staleBanner} role="status">
            {t('quota_management.lamplighter_stale', { message: ready.pollError })}
          </div>
        )}
        {feed.phase === 'missing' && !isEmpty && (
          <div className={styles.notice}>
            <div>
              <h2>{t('quota_management.lamplighter_missing_title')}</h2>
              <p>{t('quota_management.lamplighter_missing_desc')}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => navigate('/plugin-store')}>
              {t('quota_management.lamplighter_install')}
            </Button>
          </div>
        )}

        {loading ? (
          <div className={styles.pools} aria-hidden="true">
            <Skeleton height={470} rounded={16} />
            <Skeleton height={470} rounded={16} />
          </div>
        ) : isEmpty ? (
          <EmptyState
            title={
              tab === 'all'
                ? t('quota_management.empty_title')
                : t(`${QUOTA_ADAPTERS[tab].i18nPrefix}.empty_title`)
            }
            description={
              tab === 'all'
                ? t('quota_management.empty_desc')
                : t(`${QUOTA_ADAPTERS[tab].i18nPrefix}.empty_desc`)
            }
            action={
              tab === 'all' ? undefined : (
                <Button variant="secondary" size="sm" onClick={() => setTab('all')}>
                  {t('auth_files.filter_all')}
                </Button>
              )
            }
          />
        ) : (
          <>
            {visiblePools.length > 0 && (
              <div className={styles.pools}>
                {visiblePools.map((pool) => (
                  <PoolCard
                    key={pool.id}
                    pool={pool}
                    providerType={normalizeProviderId(pool.provider)}
                    settings={settings}
                    resolvedTheme={resolvedTheme}
                    accountName={accountName}
                  >
                    {showAccounts &&
                      pool.accounts.map((account) => {
                        const entry = entryByIndex.get(account.authIndex);
                        if (!entry) return null;
                        const tracked = trackedAccounts.get(account.authIndex);
                        return renderRow(entry, {
                          windows: recordedWindows(tracked, pool.sourceLabel),
                          note: accountNote(tracked, account.observedAt),
                        });
                      })}
                  </PoolCard>
                ))}
              </div>
            )}

            {untrackedEntries.length > 0 && (
              <div className={styles.ledger}>
                {untrackedEntries.map((entry, index) => (
                  <div key={`${entry.type}:${getQuotaCacheKey(entry.file)}`}>
                    {untrackedEntries[index - 1]?.type !== entry.type && (
                      <QuotaLedgerGroupHeading
                        type={entry.type}
                        count={untrackedEntries.filter((item) => item.type === entry.type).length}
                      />
                    )}
                    {renderRow(entry)}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
