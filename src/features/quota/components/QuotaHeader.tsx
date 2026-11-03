import { useTranslation } from 'react-i18next';
import { IconEye, IconEyeOff, IconRefreshCw } from '@/components/ui/icons';
import styles from './QuotaHeader.module.scss';

export type QuotaHeaderProps = {
  totalCount: number;
  /** Second meta item, such as "11 tracked"; omitted while unknown. */
  detail?: string;
  showEmails: boolean;
  onToggleEmails: () => void;
  actionLabel: string;
  actionTitle?: string;
  busy: boolean;
  disabled: boolean;
  onAction: () => void;
};

/**
 * Quota page header: title with an inline meta line, an email privacy toggle, and one
 * primary action. Entrance motion runs through the page's `useRevealGroup` (`data-reveal`).
 */
export function QuotaHeader(props: QuotaHeaderProps) {
  const { t } = useTranslation();
  return (
    <header className={styles.header}>
      <div className={styles.copy}>
        <h1 className={styles.title} data-reveal>
          {t('quota_management.title')}
        </h1>
        <p className={styles.meta} data-reveal>
          <span>{t('quota_management.meta_credentials', { count: props.totalCount })}</span>
          {props.detail && (
            <>
              <span className={styles.metaDot} aria-hidden="true">
                ·
              </span>
              <span>{props.detail}</span>
            </>
          )}
        </p>
      </div>
      <div className={styles.actions} data-reveal>
        <button
          type="button"
          className={styles.secondaryAction}
          onClick={props.onToggleEmails}
          aria-pressed={props.showEmails}
        >
          {props.showEmails ? <IconEyeOff size={16} /> : <IconEye size={16} />}
          {t(props.showEmails ? 'quota_management.hide_emails' : 'quota_management.show_emails')}
        </button>
        <button
          type="button"
          className={styles.primaryAction}
          onClick={props.onAction}
          disabled={props.disabled || props.busy}
          title={props.actionTitle}
        >
          <IconRefreshCw size={16} className={props.busy ? styles.spinning : undefined} />
          {props.actionLabel}
        </button>
      </div>
    </header>
  );
}
