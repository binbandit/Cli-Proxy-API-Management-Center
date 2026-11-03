import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClaudeQuotaState } from '@/types';
import { IconChevronDown, IconRefreshCw } from '@/components/ui/icons';
import { getTypeLabel } from '@/features/authFiles/constants';
import { getQuotaDisplayName } from '@/utils/quota/identity';
import { buildResetDisplay } from '@/utils/quota';
import { useNow } from '@/hooks/useNow';
import { ledgerWindows, maskQuotaEmail, type LedgerWindow } from '../quotaLedgerModel';
import type { QuotaProviderType } from '../providers/types';
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

export type QuotaLedgerRowProps = QuotaCardProps & {
  showEmails: boolean;
  /** Windows recorded in the background, shown until the user fetches this account. */
  recordedWindows?: LedgerWindow[];
  /** Freshness of the recorded windows, or why the last background read failed. */
  recordedNote?: ReactNode;
};

export function QuotaLedgerRow(props: QuotaLedgerRowProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { entry, quota, canRefresh, onRefresh, showEmails, recordedWindows = [] } = props;
  const fetchedWindows = ledgerWindows(entry.type, quota, t);
  // A fetch the user asked for wins; until then the background recording stands in.
  const showFetched =
    fetchedWindows.length > 0 && (quota?.status === 'success' || recordedWindows.length === 0);
  const windows = showFetched ? fetchedWindows : recordedWindows;
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
          {!showFetched && props.recordedNote && (
            <span className={styles.recordedNote}>{props.recordedNote}</span>
          )}
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
      {showFetched && (quota?.status !== 'success' || claudeQuota?.stale === true) && (
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
