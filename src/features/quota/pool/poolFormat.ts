/**
 * Text for the quota pools: amounts, rates, instants and durations, in the page language.
 */

import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';

export const formatPoolPercent = (value: number): string => `${Math.round(value)}%`;

/** Rates keep one decimal below 10 so a slow burn does not round to zero. */
export const formatRate = (value: number): string =>
  `${value === 0 ? 0 : value < 10 ? value.toFixed(1) : Math.round(value)}%/h`;

const formatter = (locale: string | undefined, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale, options);

/** "Tue 10:00 AM" within a week of now, "Nov 9, 10:00 AM" further out. */
export function formatInstant(at: number, now: number, locale?: string): string {
  const near = Math.abs(at - now) < 6 * DAY_MS;
  return formatter(locale, {
    ...(near ? { weekday: 'short' } : { month: 'short', day: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);
}

/** "Nov 9". */
export const formatDate = (at: number, locale?: string): string =>
  formatter(locale, { month: 'short', day: 'numeric' }).format(at);

/** Axis day label, such as "Fri 23": weekday first in every language. */
export const formatAxisDay = (at: number, locale?: string): string =>
  `${formatter(locale, { weekday: 'short' }).format(at)} ${formatter(locale, { day: 'numeric' }).format(at)}`;

/** Compact duration: "32m", "15h 49m", "2d 18h". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE_MS));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(ms / HOUR_MS);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(ms / DAY_MS)}d ${hours % 24}h`;
}

/** Start of the local day containing `at`. */
export function startOfLocalDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Local midnights strictly between `from` and `to`, stepping by calendar day so DST stays exact. */
export function localMidnights(from: number, to: number): number[] {
  const out: number[] = [];
  const date = new Date(startOfLocalDay(from));
  date.setDate(date.getDate() + 1);
  while (date.getTime() < to) {
    out.push(date.getTime());
    date.setDate(date.getDate() + 1);
  }
  return out;
}

const POOL_COLORS: Record<string, string> = {
  claude: '#e5835f',
  chatgpt: '#7ea3f7',
  gemini: '#3fb5d4',
  'claude / gpt': '#c08af7',
  kimi: '#e3b341',
  grok: '#a1a1aa',
  fable: '#ef7fb9',
};

const FALLBACK_COLORS = ['#7ea3f7', '#e5835f', '#3fb5d4', '#c08af7', '#e3b341', '#ef7fb9'];

/** One color per quota group, stable across reloads. */
export function poolColor(sourceLabel: string): string {
  const known = POOL_COLORS[sourceLabel.trim().toLowerCase()];
  if (known) return known;
  let hash = 0;
  for (const char of sourceLabel) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

/** The same local time `days` calendar days away, so a DST change does not shift the hour. */
export function shiftDays(at: number, days: number): number {
  const date = new Date(at);
  date.setDate(date.getDate() + days);
  return date.getTime();
}
