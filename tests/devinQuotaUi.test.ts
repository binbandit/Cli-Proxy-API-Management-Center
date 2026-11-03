import { afterEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import type { AuthFileItem, DevinQuotaState } from '@/types';
import { readDevinQuotaResponse } from '@/services/api/devinQuota';
import { DEVIN_CONFIG } from '@/features/quota/providers/devin/data';
import { DevinQuotaBody } from '@/features/quota/providers/devin/DevinQuotaBody';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import { classifyQuotaFiles } from '@/features/quota/logic';
import { QUOTA_PROVIDER_TYPES } from '@/features/authFiles/constants';
import { collectQuotaRowInstants } from '@/features/quota/resetSchedule';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useQuotaStore,
} from '@/stores/useQuotaStore';

const file: AuthFileItem = {
  name: 'devin-example.json',
  provider: 'devin',
  authIndex: 'example-index',
};
const observedAtMs = Date.parse('2099-01-01T00:00:00Z');
const livePayload = {
  userStatus: {
    planStatus: {
      dailyQuotaRemainingPercent: 0,
      weeklyQuotaRemainingPercent: 80,
      dailyQuotaResetAtUnix: Date.parse('2099-01-02T00:00:00Z') / 1000,
      weeklyQuotaResetAtUnix: Date.parse('2099-01-08T00:00:00Z') / 1000,
      planInfo: { planName: 'Pro' },
      planEnd: '2099-01-03T00:00:00Z',
    },
  },
};
const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'test'
);
const snapshot = (): DevinQuotaState => ({
  status: 'success',
  ...readDevinQuotaResponse(livePayload, observedAtMs),
});

afterEach(() => useQuotaStore.getState().clearQuotaCache());

describe('Devin quota UI integration', () => {
  test('registers the provider for credential cards but keeps it off the quota page', () => {
    expect(QUOTA_PROVIDER_TYPES.has('devin')).toBe(true);
    expect(DEVIN_CONFIG.filterFn(file)).toBe(true);
    expect(DEVIN_CONFIG.filterFn({ ...file, disabled: true })).toBe(false);
    expect(DEVIN_CONFIG.filterFn({ ...file, disabled: 'true' } as unknown as AuthFileItem)).toBe(
      false
    );
    expect(classifyQuotaFiles([file])).toEqual([]);
  });

  test('renders both remaining meters, independent resets and plan without observation time', () => {
    const markup = renderToStaticMarkup(
      createElement(DevinQuotaBody, { quota: snapshot(), classes })
    );
    expect(markup).toContain(i18n.t('devin_quota.daily'));
    expect(markup).toContain(i18n.t('devin_quota.weekly'));
    expect(markup.match(/role="meter"/g)).toHaveLength(2);
    expect(markup).toContain('aria-valuenow="0"');
    expect(markup).toContain('aria-valuenow="80"');
    expect(markup).toContain('width:0%');
    expect(markup).toContain('width:80%');
    expect(markup).toContain('Pro');
    expect(markup).toContain('01/02');
    expect(markup).toContain('01/08');
    expect(markup).not.toContain('01/01');
    expect(markup).not.toContain(classes.quotaMessage);
  });

  test('does not render an unknown observation time message', () => {
    const quota = { ...snapshot(), observedAtMs: null };
    const markup = renderToStaticMarkup(createElement(DevinQuotaBody, { quota, classes }));
    expect(markup).not.toContain(i18n.t('devin_quota.observed_unknown'));
    expect(markup).not.toContain(classes.quotaMessage);
  });

  test('renders missing quota as unavailable, not a zero-percent reading', () => {
    const quota = snapshot();
    quota.windows[0] = { ...quota.windows[0], remainingPercent: null, resetAtMs: null };
    const markup = renderToStaticMarkup(createElement(DevinQuotaBody, { quota, classes }));
    expect(markup).toContain(i18n.t('devin_quota.unavailable'));
    expect(markup).toContain(i18n.t('devin_quota.reset_unknown'));
    expect(markup).not.toContain('aria-valuenow="0"');
    expect(markup.match(/role="meter"/g)).toHaveLength(1);
  });

  test('uses daily and weekly reset instants, never subscription expiry', () => {
    const quota = snapshot();
    const instants = collectQuotaRowInstants('devin', quota);
    expect(instants.map((item) => item.rowId)).toEqual(['daily', 'weekly']);
  });

  test('invalidates only the selected Devin credential, then clears the whole session', () => {
    const quota = snapshot();
    useQuotaStore.getState().setDevinQuota({ [file.name]: quota, 'other.json': quota });
    const generation = captureQuotaCacheGeneration(file.name);
    useQuotaStore.getState().clearQuotaCache([file.name]);
    expect(useQuotaStore.getState().devinQuota[file.name]).toBeUndefined();
    expect(useQuotaStore.getState().devinQuota['other.json']).toBe(quota);
    expect(commitIfQuotaCacheCurrent(generation, () => {})).toBe(false);
    useQuotaStore.getState().clearQuotaCache();
    expect(useQuotaStore.getState().devinQuota).toEqual({});
  });
});
