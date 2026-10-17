import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { fetchDashboardBuild } from '@/services/dashboardBuild';
import styles from './DashboardUpdateNotice.module.scss';

export function DashboardUpdateNotice() {
  const { t } = useTranslation();
  const [available, setAvailable] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const current = document.querySelector<HTMLMetaElement>('meta[name="cliproxy-build"]')?.content;
    if (!current) return;
    const url = new URL(window.location.href);
    url.hash = '';
    let disposed = false;
    let pending: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      if (disposed || pending) return;
      clearTimeout(timer);
      if (!document.hidden) {
        const controller = new AbortController();
        pending = controller;
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const build = await fetchDashboardBuild(url.href, controller.signal);
          if (!disposed && build) setAvailable(build === current ? null : build);
        } catch {
          // Offline or restarting: keep the current page and retry quietly.
        } finally {
          clearTimeout(timeout);
          pending = null;
        }
      }
      if (!disposed) timer = setTimeout(check, 5000);
    };
    const onVisible = () => {
      if (!document.hidden) void check();
    };
    timer = setTimeout(check, 5000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      clearTimeout(timer);
      pending?.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!available || available === dismissed) return null;

  return (
    <aside className={styles.notice} aria-label={t('dashboard_update.title')}>
      <div role="status">
        <strong>{t('dashboard_update.title')}</strong>
        <p>{t('dashboard_update.description')}</p>
      </div>
      <div className={styles.actions}>
        <Button size="sm" variant="ghost" onClick={() => setDismissed(available)}>
          {t('dashboard_update.later')}
        </Button>
        <Button size="sm" onClick={() => window.location.reload()}>
          {t('dashboard_update.refresh')}
        </Button>
      </div>
    </aside>
  );
}
