import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClaudeQuotaState, ResolvedTheme } from '@/types';
import { IconChevronDown, IconRefreshCw } from '@/components/ui/icons';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import { getQuotaDisplayName } from '@/utils/quota/identity';
import { buildResetDisplay } from '@/utils/quota';
import { useNow } from '@/hooks/useNow';
import {
  ledgerWindows,
  maskQuotaEmail,
  summarizeLedgerWindows,
  type LedgerWindow,
} from '../quotaLedgerModel';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import type { QuotaProviderType } from '../providers/types';
import { QUOTA_TAB_ORDER } from '../constants';
import { QuotaCard, type QuotaCardProps } from './QuotaCard';
import { QUOTA_PROGRESS_HIGH_THRESHOLD, QUOTA_PROGRESS_MEDIUM_THRESHOLD } from './QuotaMeter';
import styles from './QuotaLedger.module.scss';

function ResetTime({ at }: { at: number | null }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const display = buildResetDisplay(null, at, now, i18n.resolvedLanguage);
  return (
    <span className={styles.reset}>
      {display ? (
        <>
          {display.relative ?? display.absolute}
          {display.relative && <span> · {display.absolute}</span>}
        </>
      ) : (
        t('quota_management.ledger_reset_unknown')
      )}
    </span>
  );
}

function Meter({ window }: { window: LedgerWindow }) {
  const level =
    window.remaining === null
      ? styles.unknown
      : window.remaining >= QUOTA_PROGRESS_HIGH_THRESHOLD
        ? styles.high
        : window.remaining >= QUOTA_PROGRESS_MEDIUM_THRESHOLD
          ? styles.medium
          : styles.low;
  return (
    <div className={styles.metric}>
      <div className={styles.metricHeading}>
        <span title={window.label}>{window.label}</span>
        <strong>{window.remaining === null ? '—' : `${Math.round(window.remaining)}%`}</strong>
      </div>
      <div className={styles.track}>
        <span className={level} style={{ width: `${window.remaining ?? 0}%` }} />
      </div>
      <ResetTime at={window.resetAtMs} />
    </div>
  );
}

export function QuotaSummary({
  entries,
  quotaFor,
  resolvedTheme,
}: {
  entries: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  resolvedTheme: ResolvedTheme;
}) {
  const { t } = useTranslation();
  const groups = QUOTA_TAB_ORDER.map((type) => ({
    type,
    entries: entries.filter((entry) => entry.type === type),
  })).filter((group) => group.entries.length);
  if (!groups.length) return null;
  return (
    <section className={styles.summary} aria-label={t('quota_management.ledger_summary')}>
      {groups.map(({ type, entries: group }) => {
        const summary =
          type === 'plugin'
            ? null
            : summarizeLedgerWindows(
                group.map((entry) =>
                  ledgerWindows(
                    type,
                    quotaFor(entry)?.status === 'success' ? quotaFor(entry) : undefined,
                    t
                  )
                )
              );
        return (
          <div key={type} className={styles.summaryItem}>
            <div className={styles.summaryHeading}>
              <span>
                <img src={getAuthFileIcon(type, resolvedTheme) ?? undefined} alt="" />
                {getTypeLabel(t, type)}
              </span>
              <small>{t('quota_management.meta_credentials', { count: group.length })}</small>
            </div>
            <div className={styles.summaryLabel}>
              {summary?.label ?? t('quota_management.ledger_remaining')}
            </div>
            <div className={styles.summaryValue} title={t('quota_management.ledger_sum_hint')}>
              <strong>{summary?.total == null ? '—' : `${Math.round(summary.total)}%`}</strong>
              {summary && summary.capacity > 0 && (
                <span>{t('quota_management.ledger_capacity', { capacity: summary.capacity })}</span>
              )}
            </div>
            <div className={styles.segments} aria-hidden="true">
              {group.map((entry) => {
                const windows = ledgerWindows(
                  type,
                  quotaFor(entry)?.status === 'success' ? quotaFor(entry) : undefined,
                  t
                );
                const match = summary
                  ? windows.find(
                      (window) =>
                        window.id === summary.values[0]?.id &&
                        window.periodHours === summary.values[0]?.periodHours
                    )
                  : undefined;
                const value = match?.remaining;
                return (
                  <div
                    key={`${entry.file.name}:${entry.file.authIndex ?? ''}`}
                    className={styles.track}
                  >
                    <span
                      className={
                        value == null
                          ? styles.unknown
                          : value >= QUOTA_PROGRESS_HIGH_THRESHOLD
                            ? styles.high
                            : value >= QUOTA_PROGRESS_MEDIUM_THRESHOLD
                              ? styles.medium
                              : styles.low
                      }
                      style={{ width: `${value ?? 0}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <ResetTime at={summary?.resetAtMs ?? null} />
            {(summary?.loaded ?? 0) < group.length && (
              <div className={styles.coverage}>
                {t('quota_management.ledger_coverage', {
                  loaded: summary?.loaded ?? 0,
                  total: group.length,
                })}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

export function QuotaLedgerRow(props: QuotaCardProps & { showEmails: boolean }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { entry, quota, canRefresh, onRefresh, showEmails } = props;
  const windows = ledgerWindows(entry.type, quota, t);
  const fullName = getQuotaDisplayName(entry.file);
  const name = showEmails ? fullName : maskQuotaEmail(fullName);
  const busy = quota?.status === 'loading' || props.resetting;
  const claudeQuota = entry.type === 'claude' ? (quota as ClaudeQuotaState | undefined) : undefined;
  return (
    <article className={styles.row}>
      <div className={styles.rowMain}>
        <div className={styles.identity}>
          <strong title={name}>{name}</strong>
          <button
            className={styles.detailsToggle}
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            {t(
              expanded ? 'quota_management.ledger_hide_details' : 'quota_management.ledger_details'
            )}
            <IconChevronDown size={13} className={expanded ? styles.chevronOpen : undefined} />
          </button>
        </div>
        <div className={styles.metrics}>
          {windows.length ? (
            windows.slice(0, 3).map((window) => <Meter key={window.id} window={window} />)
          ) : (
            <span className={styles.status} role={quota?.status === 'error' ? 'alert' : 'status'}>
              {t(
                quota?.status === 'loading'
                  ? 'quota_management.ledger_loading'
                  : quota?.status === 'error'
                    ? 'quota_management.ledger_error'
                    : quota?.status === 'success'
                      ? 'quota_management.ledger_no_windows'
                      : 'quota_management.ledger_idle'
              )}
            </span>
          )}
        </div>
        <button className={styles.refresh} onClick={onRefresh} disabled={!canRefresh || busy}>
          <IconRefreshCw size={14} className={busy ? styles.spinning : undefined} />
          {t('auth_files.quota_refresh_single')}
        </button>
      </div>
      {windows.length > 0 && (quota?.status !== 'success' || claudeQuota?.stale === true) && (
        <p className={styles.status} role="status">
          {t('claude_quota.stale_snapshot', {
            time: claudeQuota?.observedAt ? new Date(claudeQuota.observedAt).toLocaleString() : '—',
          })}
        </p>
      )}
      {expanded && (
        <div className={styles.details}>
          <QuotaCard {...props} displayName={name} entranceDelayMs={null} />
        </div>
      )}
    </article>
  );
}

export function QuotaLedgerGroupHeading({
  type,
  count,
}: {
  type: QuotaProviderType;
  count: number;
}) {
  const { t } = useTranslation();
  return (
    <h2 className={styles.groupHeading}>
      {getTypeLabel(t, type)}
      <span>{count}</span>
    </h2>
  );
}
