import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import type { ClaudeQuotaState } from '@/types';
import { ledgerWindows, maskQuotaEmail } from '@/features/quota/quotaLedgerModel';

const t = ((key: string) => key) as TFunction;

describe('quota ledger reporting', () => {
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
