import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import { DAY_MS, MINUTE_MS } from '@/utils/time/durations';
import { TYPICAL_RATE_SPAN_MS, type FutureUsageId } from '../constants';
import { PoolChart, type ChartResetMark } from './PoolChart';
import {
  burnRates,
  poolCapacity,
  poolRemaining,
  projectPool,
  recordedDrain,
  recordedResets,
  recordedSeries,
  type ChartPoint,
  type Pool,
} from './poolModel';
import {
  formatDate,
  formatDuration,
  formatInstant,
  formatPoolPercent,
  formatRate,
  poolColor,
} from './poolFormat';
import styles from './PoolCard.module.scss';

export type PoolMetric = 'remaining' | 'drain';

export interface PoolViewSettings {
  metric: PoolMetric;
  burnSpanMs: number;
  future: FutureUsageId;
  viewStart: number;
  viewEnd: number;
  now: number;
}

interface PoolCardProps {
  pool: Pool;
  /** Dashboard provider type, for the icon and label. */
  providerType: string;
  settings: PoolViewSettings;
  resolvedTheme: ResolvedTheme;
  /** Name shown for an account, such as its email or Lamplighter's short label. */
  accountName: (authIndex: string) => string;
  children?: ReactNode;
}

/** Projections run two weeks ahead, past the visible range, so stats look as far as resets do. */
const HORIZON_MS = 14 * DAY_MS;

/** Groups each provider reports by default: their pools take the provider's own name. */
const DEFAULT_GROUPS: Record<string, string> = {
  claude: 'claude',
  codex: 'chatgpt',
  kimi: 'kimi',
  xai: 'grok',
};

function chartStep(span: number) {
  const steps = [5, 10, 15, 30, 60].map((minutes) => minutes * MINUTE_MS);
  return steps.find((step) => span / step <= 1600) ?? 2 * 60 * MINUTE_MS;
}

/** Smallest round axis top that clears the highest rate with some headroom. */
function rateAxisTop(points: ChartPoint[]) {
  const peak = Math.max(0, ...points.map((point) => point.value)) * 1.1;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(peak, 0.5)));
  return ([1, 2, 2.5, 5, 10].find((factor) => factor * magnitude >= peak) ?? 10) * magnitude;
}

/** Pool value right after `at`: the higher of the readings that share the instant. */
function valueAfter(points: ChartPoint[], at: number): number {
  let value = 0;
  for (const point of points) {
    if (point.at < at) continue;
    if (point.at > at && value > 0) break;
    value = Math.max(value, point.value);
    if (point.at > at) break;
  }
  return value;
}

export function PoolCard({
  pool,
  providerType,
  settings,
  resolvedTheme,
  accountName,
  children,
}: PoolCardProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const { metric, burnSpanMs, future, viewStart, viewEnd, now } = settings;
  const color = poolColor(pool.sourceLabel);
  const capacity = poolCapacity(pool);
  const remaining = poolRemaining(pool);
  const typeLabel = getTypeLabel(t, providerType);
  const title =
    DEFAULT_GROUPS[providerType] === pool.sourceLabel.toLowerCase()
      ? typeLabel
      : `${typeLabel} · ${pool.sourceLabel}`;

  const model = useMemo(() => {
    const step = chartStep(viewEnd - viewStart);
    const burn = burnRates(pool, burnSpanMs, now);
    const shares =
      future === 'recent'
        ? burn.byAccount
        : future === 'typical'
          ? burnRates(pool, TYPICAL_RATE_SPAN_MS, now).byAccount
          : new Map<string, number>();
    const projection = projectPool(pool, {
      now,
      horizon: Math.max(viewEnd, now + HORIZON_MS),
      stepMs: step,
      shares,
    });
    const recordFrom = Math.min(now, viewStart - step);
    const recorded = viewStart < now ? recordedSeries(pool, recordFrom, now, step) : [];
    const resets: ChartResetMark[] = [
      ...recordedResets(pool, recordFrom, now).map((mark) => ({
        ...mark,
        value: valueAfter(recorded, mark.at),
      })),
      ...projection.resets.map((mark) => ({
        ...mark,
        value: valueAfter(projection.points, mark.at),
      })),
    ];
    const drain =
      metric === 'drain' && viewStart < now
        ? recordedDrain(pool, recordFrom, now, step, burnSpanMs)
        : [];
    return { burn, projection, recorded, resets, drain };
  }, [pool, burnSpanMs, future, metric, now, viewStart, viewEnd]);

  const horizonLabel = formatDate(now + HORIZON_MS, locale);
  const notBy = t('quota_management.stat_not_by', { date: horizonLabel });
  const { burn, projection } = model;

  const weightNotes = [
    ...new Set(
      pool.accounts
        .filter((account) => account.weight !== 1)
        .map((account) =>
          t('quota_management.weight_note', {
            plan: account.plan || account.title,
            weight: Number(account.weight.toFixed(2)),
          })
        )
    ),
  ];

  const stats = [
    {
      label: t('quota_management.stat_pool_empty'),
      value:
        projection.poolEmpty === null
          ? notBy
          : projection.poolEmpty <= now
            ? t('quota_management.stat_now')
            : formatInstant(projection.poolEmpty, now, locale),
    },
    {
      label: t('quota_management.stat_first_empty'),
      value: projection.firstEmpty ? (
        <>
          <span className={styles.who}>{accountName(projection.firstEmpty.account.authIndex)}</span>
          {t('quota_management.stat_in', {
            duration: formatDuration(projection.firstEmpty.at - now),
          })}
        </>
      ) : (
        notBy
      ),
    },
    {
      label: t('quota_management.stat_next_reset'),
      value: projection.nextReset
        ? `+${formatPoolPercent(projection.nextReset.gain)} ${formatInstant(projection.nextReset.at, now, locale)}`
        : t('quota_management.stat_no_reset'),
    },
    {
      label: t('quota_management.stat_burn', {
        span: formatDuration(burnSpanMs).replace(' 0m', ''),
      }),
      value: burn.pool === null ? '—' : formatRate(burn.pool),
    },
  ];

  const icon = getAuthFileIcon(providerType, resolvedTheme);
  const isDrain = metric === 'drain';

  return (
    <section className={styles.card} style={{ '--pool-color': color } as CSSProperties}>
      <header className={styles.header}>
        {icon && <img className={styles.icon} src={icon} alt="" />}
        <h2 className={styles.title}>{title}</h2>
        <span className={styles.count}>
          {t('quota_management.pool_accounts', { count: pool.accounts.length })}
        </span>
      </header>

      <div className={styles.summary}>
        <div className={styles.headline}>
          <strong>{formatPoolPercent(remaining)}</strong>
          <span>{t('quota_management.pool_of', { capacity: formatPoolPercent(capacity) })}</span>
          {weightNotes.length > 0 && (
            <span className={styles.weights}>{weightNotes.join(' · ')}</span>
          )}
        </div>
        <dl className={styles.stats}>
          {stats.map((stat) => (
            <div key={stat.label} className={styles.stat}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <PoolChart
        color={color}
        max={isDrain ? rateAxisTop([...model.drain, ...projection.drain]) : capacity}
        viewStart={viewStart}
        viewEnd={viewEnd}
        now={now}
        recorded={isDrain ? model.drain : model.recorded}
        projected={isDrain ? projection.drain : projection.points}
        resets={isDrain ? [] : model.resets}
        emptyAt={isDrain ? null : projection.poolEmpty}
        formatValue={isDrain ? formatRate : formatPoolPercent}
        describeValue={(value) =>
          isDrain
            ? t('quota_management.chart_used', { value: formatRate(value) })
            : t('quota_management.chart_left', { value: formatPoolPercent(value) })
        }
        ariaLabel={t('quota_management.chart_aria', {
          pool: title,
          remaining: formatPoolPercent(remaining),
          capacity: formatPoolPercent(capacity),
        })}
      />

      <footer className={styles.legend}>
        <span className={styles.legendTitle}>
          {t(isDrain ? 'quota_management.legend_drain' : 'quota_management.legend_pool')}
        </span>
        <span className={styles.legendItem}>
          <i className={styles.swatchSolid} aria-hidden="true" />
          {t('quota_management.chart_recorded_label')}
        </span>
        <span className={styles.legendItem}>
          <i className={styles.swatchDashed} aria-hidden="true" />
          {t('quota_management.chart_projected_label')}
        </span>
      </footer>

      {children && <div className={styles.accounts}>{children}</div>}
    </section>
  );
}
