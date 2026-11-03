import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { DAY_MS } from '@/utils/time/durations';
import type { ChartPoint } from './poolModel';
import { formatAxisDay, formatInstant, localMidnights } from './poolFormat';
import styles from './PoolChart.module.scss';

export interface ChartResetMark {
  at: number;
  gain: number;
  /** Pool value right after the reset, where its label sits. */
  value: number;
}

export interface PoolChartProps {
  color: string;
  /** Top of the value axis. */
  max: number;
  viewStart: number;
  viewEnd: number;
  now: number;
  recorded: ChartPoint[];
  projected: ChartPoint[];
  resets: ChartResetMark[];
  /** When the pool runs dry, marked on the zero line. */
  emptyAt: number | null;
  formatValue: (value: number) => string;
  /** Hover text for a value, such as "398% left". */
  describeValue: (value: number) => string;
  ariaLabel: string;
}

const HEIGHT = 330;
const PAD = { top: 40, right: 18, bottom: 34, left: 58 };
const LABEL_GAP = 42;
/** Hover readouts land on quarter hours, which read better than arbitrary minutes. */
const HOVER_SNAP_MS = 15 * 60_000;

/** Last point at or before `at`: recorded readings hold until the next one. */
function stepValue(points: ChartPoint[], at: number): number | null {
  let low = 0;
  let high = points.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (points[mid].at <= at) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found === -1 ? null : points[found].value;
}

/** Straight-line value between projected points; a jump resolves to its later value. */
function linearValue(points: ChartPoint[], at: number): number | null {
  if (points.length === 0 || at < points[0].at) return null;
  for (let index = 1; index < points.length; index += 1) {
    const next = points[index];
    if (next.at < at) continue;
    const previous = points[index - 1];
    if (next.at === previous.at) return next.value;
    const share = (at - previous.at) / (next.at - previous.at);
    return previous.value + (next.value - previous.value) * share;
  }
  return null;
}

export function PoolChart(props: PoolChartProps) {
  const { color, max, viewStart, viewEnd, now, recorded, projected } = props;
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const gradientId = useId();
  const clipId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);
  const [hoverAt, setHoverAt] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const update = () => setWidth(Math.max(320, element.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const span = Math.max(1, viewEnd - viewStart);
  const top = Math.max(1, max);
  const x = (at: number) => PAD.left + ((at - viewStart) / span) * plotWidth;
  const y = (value: number) => PAD.top + (1 - Math.max(0, Math.min(top, value)) / top) * plotHeight;
  const baseline = y(0);

  const geometry = useMemo(() => {
    const inView = (points: ChartPoint[]) => {
      // Keep one point beyond each edge so lines run to the frame instead of stopping short.
      const first = Math.max(0, points.findIndex((point) => point.at >= viewStart) - 1);
      let last = points.length - 1;
      while (last > 0 && points[last - 1].at > viewEnd) last -= 1;
      return points.slice(first, last + 1);
    };
    const line = (points: ChartPoint[]) =>
      points
        .map(
          (point, index) =>
            `${index ? 'L' : 'M'}${x(point.at).toFixed(1)},${y(point.value).toFixed(1)}`
        )
        .join('');
    const shownRecorded = inView(recorded);
    const shownProjected = inView(projected);
    const both = [...shownRecorded, ...shownProjected];
    const area =
      both.length > 1
        ? `${line(both)}L${x(both[both.length - 1].at).toFixed(1)},${baseline}L${x(both[0].at).toFixed(1)},${baseline}Z`
        : '';
    return { recordedPath: line(shownRecorded), projectedPath: line(shownProjected), area };
    // x and y derive from the values listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorded, projected, viewStart, viewEnd, width, top]);

  const days = useMemo(() => {
    const midnights = localMidnights(viewStart, viewEnd);
    const bounds = [viewStart, ...midnights, viewEnd];
    const labels = bounds.slice(0, -1).map((start, index) => ({
      at: start,
      center: (Math.max(start, viewStart) + Math.min(bounds[index + 1], viewEnd)) / 2,
      width:
        ((Math.min(bounds[index + 1], viewEnd) - Math.max(start, viewStart)) / span) * plotWidth,
    }));
    // Thin labels to every Nth day so each keeps about 52px; drop clipped partial days.
    const dayWidth = (DAY_MS / span) * plotWidth;
    const every = Math.max(1, Math.ceil(52 / dayWidth));
    return {
      midnights,
      labels: labels.filter((label, index) => label.width >= 0.6 * dayWidth && index % every === 0),
    };
  }, [viewStart, viewEnd, span, plotWidth]);

  const nowValue = stepValue(recorded, now) ?? projected[0]?.value ?? null;
  const nowVisible = now >= viewStart && now <= viewEnd;

  // Reset labels sit above their jump; a label that would collide with the previous one
  // moves up a line, and one that would still collide is dropped.
  const resetLabels = useMemo(() => {
    const placed: { x: number; y: number; text: string }[] = [];
    const ceiling = PAD.top - 22;
    const clashes = (labelX: number, labelY: number) =>
      placed.some(
        (label) => Math.abs(label.x - labelX) < LABEL_GAP && Math.abs(label.y - labelY) < 14
      );
    for (const mark of [...props.resets].sort((a, b) => a.at - b.at)) {
      if (mark.at < viewStart || mark.at > viewEnd) continue;
      const labelX = x(mark.at);
      // Try the natural spot, then one and two lines higher; drop the label if all clash.
      const spot = [0, 14, 28]
        .map((lift) => Math.max(ceiling, y(mark.value) - 9 - lift))
        .find((labelY) => !clashes(labelX, labelY));
      if (spot === undefined) continue;
      placed.push({ x: labelX, y: spot, text: `+${Math.round(mark.gain)}%` });
    }
    return placed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.resets, viewStart, viewEnd, width, top]);

  const hover = useMemo(() => {
    if (hoverAt === null) return null;
    const isRecorded = hoverAt <= now;
    const value = isRecorded ? stepValue(recorded, hoverAt) : linearValue(projected, hoverAt);
    if (value === null) return null;
    return { at: hoverAt, value, isRecorded };
  }, [hoverAt, now, recorded, projected]);

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset = event.clientX - bounds.left;
    if (offset < PAD.left || offset > width - PAD.right) {
      setHoverAt(null);
      return;
    }
    const at = viewStart + ((offset - PAD.left) / plotWidth) * span;
    setHoverAt(
      Math.min(viewEnd, Math.max(viewStart, Math.round(at / HOVER_SNAP_MS) * HOVER_SNAP_MS))
    );
  };

  const emptyVisible =
    props.emptyAt !== null && props.emptyAt >= viewStart && props.emptyAt <= viewEnd;
  const emptyX = emptyVisible ? x(props.emptyAt as number) : 0;
  const tooltipLeft = hover ? x(hover.at) : 0;
  const tooltipFlip = tooltipLeft > width - 300;

  return (
    <div ref={wrapRef} className={styles.wrap} style={{ '--pool-color': color } as CSSProperties}>
      <svg
        className={styles.svg}
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={props.ariaLabel}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHoverAt(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.26} />
            <stop offset="100%" stopColor={color} stopOpacity={0.01} />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x={PAD.left} y={PAD.top - 2} width={plotWidth} height={plotHeight + 4} />
          </clipPath>
        </defs>

        {[0, 0.5, 1].map((share) => (
          <g key={share}>
            <line
              className={share === 0 ? styles.baseline : styles.grid}
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(top * share)}
              y2={y(top * share)}
            />
            <text className={styles.axis} x={PAD.left - 12} y={y(top * share) + 4} textAnchor="end">
              {props.formatValue(top * share)}
            </text>
          </g>
        ))}
        {days.midnights.map((at) => (
          <line key={at} className={styles.grid} x1={x(at)} x2={x(at)} y1={PAD.top} y2={baseline} />
        ))}
        {days.labels.map((label) => (
          <text
            key={label.at}
            className={styles.axis}
            x={x(label.center)}
            y={HEIGHT - 10}
            textAnchor="middle"
          >
            {formatAxisDay(Math.max(label.at, viewStart), locale)}
          </text>
        ))}

        <g clipPath={`url(#${clipId})`}>
          {geometry.area && <path d={geometry.area} fill={`url(#${gradientId})`} />}
          <path className={styles.recorded} d={geometry.recordedPath} />
          <path className={styles.projected} d={geometry.projectedPath} />
        </g>

        {resetLabels.map((label) => (
          <text
            key={`${label.x}:${label.y}`}
            className={styles.resetLabel}
            x={label.x}
            y={label.y}
            textAnchor="middle"
          >
            {label.text}
          </text>
        ))}

        {nowVisible && (
          <g>
            <line
              className={styles.nowLine}
              x1={x(now)}
              x2={x(now)}
              y1={PAD.top - 10}
              y2={HEIGHT - 4}
            />
            <text className={styles.nowLabel} x={x(now)} y={PAD.top - 18} textAnchor="middle">
              {t('quota_management.chart_now')}
            </text>
            {nowValue !== null && (
              <circle className={styles.nowDot} cx={x(now)} cy={y(nowValue)} r={4.5} />
            )}
          </g>
        )}

        {emptyVisible && (
          <g>
            <text
              className={styles.emptyLabel}
              x={Math.min(Math.max(emptyX, PAD.left + 70), width - PAD.right - 70)}
              y={baseline - 14}
              textAnchor="middle"
            >
              {t('quota_management.chart_empty', {
                time: formatInstant(props.emptyAt as number, now, locale),
              })}
            </text>
            <circle className={styles.emptyDot} cx={emptyX} cy={baseline} r={6} />
          </g>
        )}

        {hover && (
          <g pointerEvents="none">
            <line
              className={styles.hoverLine}
              x1={x(hover.at)}
              x2={x(hover.at)}
              y1={PAD.top}
              y2={baseline}
            />
            <circle className={styles.hoverDot} cx={x(hover.at)} cy={y(hover.value)} r={4} />
          </g>
        )}
      </svg>
      {hover && (
        <div
          className={styles.tooltip}
          aria-hidden="true"
          style={
            tooltipFlip
              ? { right: width - tooltipLeft + 10, top: PAD.top - 34 }
              : { left: tooltipLeft + 10, top: PAD.top - 34 }
          }
        >
          {formatInstant(hover.at, now, locale)} · {props.describeValue(hover.value)} ·{' '}
          {t(
            hover.isRecorded
              ? 'quota_management.chart_recorded'
              : 'quota_management.chart_projected'
          )}
        </div>
      )}
    </div>
  );
}
