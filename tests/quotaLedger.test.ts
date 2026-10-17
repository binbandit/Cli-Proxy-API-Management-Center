import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import type { ClaudeQuotaState } from '@/types';
import {
  ledgerWindows,
  maskQuotaEmail,
  summarizeLedgerWindows,
  type LedgerWindow,
} from '@/features/quota/quotaLedgerModel';
const t = ((key: string) => key) as TFunction;
const window = (id: string, remaining: number | null, periodHours = 168): LedgerWindow => ({
  id,
  label: id,
  remaining,
  periodHours,
  resetAtMs: null,
});

describe('quota ledger reporting', () => {
  test('unknown amounts are excluded from capacity instead of becoming unused quota', () => {
    const result = summarizeLedgerWindows([[window('weekly', 17)], [window('weekly', null)], []]);
    expect(result?.total).toBe(17);
    expect(result?.capacity).toBe(100);
    expect(result?.loaded).toBe(1);
    expect(summarizeLedgerWindows([[window('weekly', null)]])?.total).toBeNull();
    expect(summarizeLedgerWindows([])).toBeNull();
  });
  test('only matching scopes and durations contribute to a provider total', () => {
    const result = summarizeLedgerWindows([
      [window('weekly', 6), window('spark-weekly', 100)],
      [window('weekly', 4), window('spark-weekly', 100)],
      [window('weekly', 90, 5)],
    ]);
    expect(result?.total).toBe(10);
    expect(result?.capacity).toBe(200);
  });
  test('remaining quota is available without a reset timestamp', () => {
    const quota: ClaudeQuotaState = {
      status: 'success',
      windows: [{ id: 'seven_day', label: 'Weekly', usedPercent: 42, resetLabel: '' }],
    };
    expect(ledgerWindows('claude', quota, t)[0]).toMatchObject({ remaining: 58, resetAtMs: null });
    expect(
      ledgerWindows('claude', { ...quota, status: 'error', stale: true }, t)[0].remaining
    ).toBe(58);
    expect(
      ledgerWindows(
        'claude',
        { ...quota, windows: [{ ...quota.windows[0], usedPercent: NaN }] },
        t
      )[0].remaining
    ).toBeNull();
  });
  test('unknown fractions and zero limits remain unknown', () => {
    expect(
      ledgerWindows(
        'antigravity',
        {
          status: 'success',
          groups: [
            { id: 'g', label: 'g', buckets: [{ id: 'b', label: 'b', remainingFraction: NaN }] },
          ],
        },
        t
      )[0].remaining
    ).toBeNull();
    expect(
      ledgerWindows(
        'kimi',
        { status: 'success', rows: [{ id: 'w', label: 'Weekly', used: 0, limit: 0 }] },
        t
      )[0].remaining
    ).toBeNull();
  });
  test('email masking covers filenames and identity labels without changing plain names', () => {
    expect(maskQuotaEmail('claude-taylor@studio.dev.json')).toBe('claude-t•••@s•••.json');
    expect(maskQuotaEmail('account.json · alex+work@example.com')).toBe('account.json · a•••@e•••');
    expect(maskQuotaEmail('service-account.json')).toBe('service-account.json');
  });
});
