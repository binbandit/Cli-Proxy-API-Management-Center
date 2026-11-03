/**
 * 额度页纯逻辑：文件归类、tab 过滤、计数、分页。
 * React-free —— 由 tests/quotaPageLogic.test.ts 直接消费。
 */

import type { AuthFileItem } from '@/types';
import { ANTIGRAVITY_CONFIG } from './providers/antigravity/data';
import { CLAUDE_CONFIG } from './providers/claude/data';
import { CODEX_CONFIG } from './providers/codex/data';
import { DEVIN_CONFIG } from './providers/devin/data';
import { KIMI_CONFIG } from './providers/kimi/data';
import { META_CONFIG } from './providers/meta/data';
import { PLUGIN_CONFIG } from './providers/plugin/data';
import { XAI_CONFIG } from './providers/xai/data';
import type { QuotaProviderType } from './providers/types';
import { QUOTA_TAB_ORDER, type QuotaTabId } from './constants';

const QUOTA_FILTER_MAP: Record<QuotaProviderType, (file: AuthFileItem) => boolean> = {
  antigravity: ANTIGRAVITY_CONFIG.filterFn,
  claude: CLAUDE_CONFIG.filterFn,
  codex: CODEX_CONFIG.filterFn,
  devin: DEVIN_CONFIG.filterFn,
  kimi: KIMI_CONFIG.filterFn,
  meta: META_CONFIG.filterFn,
  plugin: PLUGIN_CONFIG.filterFn,
  xai: XAI_CONFIG.filterFn,
};

export interface QuotaFileEntry {
  file: AuthFileItem;
  type: QuotaProviderType;
}

export const resolveQuotaProviderType = (file: AuthFileItem): QuotaProviderType | null =>
  PLUGIN_CONFIG.filterFn(file)
    ? 'plugin'
    : (QUOTA_TAB_ORDER.find((type) => QUOTA_FILTER_MAP[type](file)) ?? null);

/**
 * 把文件列表归类为额度条目：不支持额度或已停用的文件被过滤，
 * 结果按 QUOTA_TAB_ORDER 分组排列（'全部' tab 的卡片顺序即由此决定）。
 */
export function classifyQuotaFiles(files: AuthFileItem[]): QuotaFileEntry[] {
  const groups = new Map<QuotaProviderType, QuotaFileEntry[]>(
    QUOTA_TAB_ORDER.map((type) => [type, []])
  );
  for (const file of files) {
    const type = resolveQuotaProviderType(file);
    if (!type) continue;
    groups.get(type)?.push({ file, type });
  }
  return QUOTA_TAB_ORDER.flatMap((type) => groups.get(type) ?? []);
}

export function filterEntriesByTab(entries: QuotaFileEntry[], tab: QuotaTabId): QuotaFileEntry[] {
  if (tab === 'all') return entries;
  return entries.filter((entry) => entry.type === tab);
}

export function buildTabCounts(entries: QuotaFileEntry[]): Record<string, number> {
  const counts: Record<string, number> = { all: entries.length };
  for (const type of QUOTA_TAB_ORDER) {
    counts[type] = 0;
  }
  for (const entry of entries) {
    counts[entry.type] += 1;
  }
  return counts;
}

export const isQuotaRefreshDisabled = (
  canRefresh: boolean,
  loading: boolean,
  resetting: boolean
): boolean => !canRefresh || loading || resetting;
