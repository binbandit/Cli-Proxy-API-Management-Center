import { describe, expect, test } from 'bun:test';
import {
  buildTabCounts,
  classifyQuotaFiles,
  filterEntriesByTab,
  isQuotaRefreshDisabled,
  resolveQuotaProviderType,
} from '@/features/quota/logic';
import type { AuthFileItem } from '@/types';

const file = (name: string, provider: string, extra: Partial<AuthFileItem> = {}): AuthFileItem =>
  ({ name, provider, ...extra }) as AuthFileItem;

const FILES: AuthFileItem[] = [
  file('codex-a.json', 'codex'),
  file('claude-a.json', 'claude'),
  file('kimi-a.json', 'kimi'), // built-in quota, but not shown on this page
  file('codex-b.json', 'codex'),
  file('grok-a.json', 'grok'), // xAI alias, not shown on this page
  file('gemini-a.json', 'gemini'), // no quota support
  file('claude-off.json', 'claude', { disabled: true }), // disabled
];

describe('resolveQuotaProviderType', () => {
  test('keeps the page to Claude, Codex and plugin quotas', () => {
    expect(resolveQuotaProviderType(file('a', 'claude'))).toBe('claude');
    expect(resolveQuotaProviderType(file('a', 'codex'))).toBe('codex');
    for (const provider of ['grok', 'xai', 'antigravity', 'kimi', 'devin', 'meta', 'gemini']) {
      expect(resolveQuotaProviderType(file('a', provider))).toBeNull();
    }
    expect(resolveQuotaProviderType(file('a', 'claude', { disabled: true }))).toBeNull();
    expect(
      resolveQuotaProviderType(
        file('kiro-a.json', 'kiro', { supportsQuota: true, quotaProvider: 'kiro', authIndex: '1' })
      )
    ).toBe('plugin');
    expect(resolveQuotaProviderType(file('kiro-probe.json', 'kiro', { supportsQuota: true }))).toBe(
      'plugin'
    );
  });
});

describe('classifyQuotaFiles', () => {
  test('drops hidden, unsupported and disabled files and groups by tab order', () => {
    expect(classifyQuotaFiles(FILES).map((entry) => entry.file.name)).toEqual([
      'claude-a.json',
      'codex-a.json',
      'codex-b.json',
    ]);
  });
});

describe('buildTabCounts', () => {
  test('counts per provider plus an all total, zero-filling empty tabs', () => {
    expect(buildTabCounts(classifyQuotaFiles(FILES))).toEqual({
      all: 3,
      claude: 1,
      codex: 2,
      plugin: 0,
    });
  });
});

describe('filterEntriesByTab', () => {
  const entries = classifyQuotaFiles(FILES);

  test("passes everything through on the 'all' tab", () => {
    expect(filterEntriesByTab(entries, 'all')).toHaveLength(3);
  });

  test('filters to a single provider', () => {
    expect(filterEntriesByTab(entries, 'codex').map((entry) => entry.file.name)).toEqual([
      'codex-a.json',
      'codex-b.json',
    ]);
    expect(filterEntriesByTab(entries, 'plugin')).toEqual([]);
  });
});

describe('isQuotaRefreshDisabled', () => {
  test('blocks a single-card refresh while the same quota is resetting', () => {
    expect(isQuotaRefreshDisabled(true, false, true)).toBe(true);
    expect(isQuotaRefreshDisabled(true, false, false)).toBe(false);
  });
});
