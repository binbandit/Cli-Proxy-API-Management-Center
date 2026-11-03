import { describe, expect, test } from 'bun:test';
import type { LamplighterAccount, LamplighterHistory, LamplighterStatus } from '@/types';
import {
  buildPools,
  burnRates,
  consumedBetween,
  poolCapacity,
  poolRemaining,
  projectPool,
  recordedDrain,
  recordedResets,
  recordedSeries,
  type Pool,
  type PoolAccount,
} from '@/features/quota/pool/poolModel';
import {
  normalizeLamplighterHistory,
  normalizeLamplighterStatus,
} from '@/services/api/lamplighter';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 26, 12);

const account = (overrides: Partial<PoolAccount> & { authIndex: string }): PoolAccount => ({
  title: overrides.authIndex,
  email: '',
  plan: '',
  weight: 1,
  remaining: 100,
  resetAt: null,
  observedAt: NOW,
  error: '',
  samples: [],
  recentSamples: [],
  ...overrides,
});

const pool = (accounts: PoolAccount[], periodMs: number | null = 7 * DAY): Pool => ({
  id: 'Claude:7d',
  sourceLabel: 'Claude',
  provider: 'claude',
  kind: '7d',
  periodMs,
  accounts,
});

const lamplighterAccount = (
  authIndex: string,
  windows: { id: string; kind: '5h' | '7d' | 'other'; remaining: number }[],
  sourceLabel = 'Claude'
): LamplighterAccount => ({
  authIndex,
  provider: 'claude',
  title: `Claude#${authIndex}`,
  email: `${authIndex}@example.com`,
  plan: 'Pro',
  defaultWeight: 1,
  unavailable: false,
  error: '',
  groups: [
    {
      key: `g-${authIndex}-${sourceLabel}`,
      sourceLabel,
      windows: windows.map((window) => ({
        ...window,
        label: window.id,
        resetAt: NOW + DAY,
        observedAt: NOW,
      })),
    },
  ],
});

describe('building pools', () => {
  const status: LamplighterStatus = {
    version: '1',
    now: NOW,
    lastPoll: null,
    nextPoll: null,
    accountWeights: {},
    groupOrder: ['ChatGPT', 'Claude', 'Fable'],
    accounts: [
      lamplighterAccount('b', [
        { id: 'five_hour', kind: '5h', remaining: 10 },
        { id: 'seven_day', kind: '7d', remaining: 40 },
      ]),
      lamplighterAccount('a', [{ id: 'seven_day', kind: '7d', remaining: 70 }]),
      lamplighterAccount('a', [{ id: 'fable', kind: 'other', remaining: 55 }], 'Fable'),
    ],
  };
  const history: LamplighterHistory = {
    from: NOW - DAY,
    to: NOW,
    series: [
      {
        groupKey: 'g-b-Claude',
        windowId: 'seven_day',
        kind: '7d',
        sourceLabel: 'Claude',
        provider: 'claude',
        authIndex: 'b',
        samples: [{ at: NOW - HOUR, remaining: 45 }],
      },
    ],
  };

  test('groups accounts by quota group, tracks the weekly window and orders by group order', () => {
    const pools = buildPools({
      status,
      history,
      recent: null,
      weightOf: (item) => (item.authIndex === 'b' ? 5 : 1),
    });
    expect(pools.map((item) => item.id)).toEqual(['Claude:7d', 'Fable:other']);
    const claude = pools[0];
    expect(claude.accounts.map((item) => [item.authIndex, item.remaining, item.weight])).toEqual([
      ['a', 70, 1],
      ['b', 40, 5],
    ]);
    expect(claude.accounts[1].samples).toEqual([{ at: NOW - HOUR, remaining: 45 }]);
    expect(poolCapacity(claude)).toBe(600);
    expect(poolRemaining(claude)).toBe(270);
    expect(pools[1].periodMs).toBeNull();
  });
});

describe('recorded history', () => {
  test('sums weighted readings and ends at now with the current readings', () => {
    const subject = pool([
      account({
        authIndex: 'a',
        remaining: 50,
        samples: [
          { at: NOW - 3 * HOUR, remaining: 80 },
          { at: NOW - HOUR, remaining: 60 },
        ],
      }),
      account({
        authIndex: 'b',
        weight: 2,
        remaining: 90,
        samples: [{ at: NOW - 2 * HOUR, remaining: 100 }],
      }),
    ]);
    const points = recordedSeries(subject, NOW - 3 * HOUR, NOW, HOUR);
    // b joins two hours ago instead of being invented backwards.
    expect(points).toEqual([
      { at: NOW - 3 * HOUR, value: 80 },
      { at: NOW - 2 * HOUR, value: 280 },
      { at: NOW - HOUR, value: 260 },
      { at: NOW, value: 230 },
    ]);
  });

  test('detects resets from rising readings and merges simultaneous ones', () => {
    const subject = pool([
      account({
        authIndex: 'a',
        samples: [
          { at: NOW - 3 * HOUR, remaining: 20 },
          { at: NOW - 2 * HOUR, remaining: 100 },
          { at: NOW - HOUR, remaining: 102 },
        ],
      }),
      account({
        authIndex: 'b',
        weight: 2,
        samples: [
          { at: NOW - 2.5 * HOUR, remaining: 40 },
          { at: NOW - 2 * HOUR + 10 * 60_000, remaining: 100 },
        ],
      }),
    ]);
    expect(recordedResets(subject, NOW - DAY, NOW)).toEqual([{ at: NOW - 2 * HOUR, gain: 200 }]);
  });
});

describe('burn rates', () => {
  const samples = [
    { at: NOW - 4 * HOUR, remaining: 90 },
    { at: NOW - 2 * HOUR, remaining: 70 },
    { at: NOW - HOUR, remaining: 100 },
    { at: NOW, remaining: 94 },
  ];

  test('only drops count and a pair straddling the start counts its inside share', () => {
    expect(consumedBetween(samples, NOW - 3 * HOUR, NOW)).toBe(16);
  });

  test('pool rate weights each account and is unknown without readings', () => {
    const subject = pool([
      account({ authIndex: 'a', weight: 2, samples }),
      account({ authIndex: 'b', samples: [{ at: NOW - 30 * 60_000, remaining: 50 }] }),
    ]);
    const rates = burnRates(subject, 3 * HOUR, NOW);
    expect(rates.pool).toBeCloseTo((2 * 16) / 3);
    expect(rates.byAccount.get('a')).toBeCloseTo((2 * 16) / 3);
    expect(rates.byAccount.has('b')).toBe(false);
    expect(burnRates(pool([account({ authIndex: 'c' })]), HOUR, NOW).pool).toBeNull();
  });

  test('recorded drain matches the trailing-span rate', () => {
    const subject = pool([account({ authIndex: 'a', samples })]);
    const drain = recordedDrain(subject, NOW - HOUR, NOW, HOUR, 3 * HOUR);
    expect(drain.map((point) => point.at)).toEqual([NOW - HOUR, NOW]);
    expect(drain[1].value).toBeCloseTo(16 / 3);
  });
});

describe('projection', () => {
  test('moves an emptied account’s demand to the others and finds both empty times', () => {
    const subject = pool(
      [account({ authIndex: 'a', remaining: 10 }), account({ authIndex: 'b', remaining: 50 })],
      null
    );
    const result = projectPool(subject, {
      now: NOW,
      horizon: NOW + 2 * DAY,
      stepMs: HOUR,
      shares: new Map([
        ['a', 10],
        ['b', 10],
      ]),
      demandScale: 1,
    });
    expect(result.firstEmpty?.account.authIndex).toBe('a');
    expect(result.firstEmpty?.at).toBe(NOW + HOUR);
    // After a empties at +1h, b (40 left) carries all 20%/h: empty two hours later.
    expect(result.poolEmpty).toBe(NOW + 3 * HOUR);
    expect(result.points[result.points.length - 1].value).toBe(0);
  });

  test('a reset refills its account and is labelled with what it brings back', () => {
    const subject = pool([
      account({ authIndex: 'a', remaining: 30, resetAt: NOW + 90 * 60_000 }),
      account({ authIndex: 'b', remaining: 100, resetAt: NOW + 3 * DAY }),
    ]);
    const result = projectPool(subject, {
      now: NOW,
      horizon: NOW + 5 * HOUR,
      stepMs: HOUR,
      shares: new Map(),
      demandScale: 1,
    });
    expect(result.nextReset).toEqual({ at: NOW + 90 * 60_000, gain: 70 });
    expect(result.points).toContainEqual({ at: NOW + 90 * 60_000, value: 130 });
    expect(result.points).toContainEqual({ at: NOW + 90 * 60_000, value: 200 });
    expect(result.firstEmpty).toBeNull();
    expect(result.poolEmpty).toBeNull();
  });

  test('a reset that passed without a new reading still happened', () => {
    const subject = pool([account({ authIndex: 'a', remaining: 0, resetAt: NOW - HOUR })]);
    const result = projectPool(subject, {
      now: NOW,
      horizon: NOW + 8 * DAY,
      stepMs: HOUR,
      shares: new Map([['a', 0.5]]),
      demandScale: 1,
    });
    expect(result.points[0]).toEqual({ at: NOW, value: 100 });
    expect(result.poolEmpty).toBeNull();
    // The next reset follows a full period after the missed one and refills what was used.
    expect(result.nextReset?.at).toBe(NOW - HOUR + 7 * DAY);
    expect(result.nextReset?.gain).toBeCloseTo(0.5 * (7 * 24 - 1));
  });

  test('a pool that is already dry is empty now', () => {
    const subject = pool([account({ authIndex: 'a', remaining: 0, resetAt: NOW + DAY })]);
    const result = projectPool(subject, {
      now: NOW,
      horizon: NOW + 2 * DAY,
      stepMs: HOUR,
      shares: new Map([['a', 5]]),
      demandScale: 1,
    });
    expect(result.poolEmpty).toBe(NOW);
    expect(result.nextReset).toEqual({ at: NOW + DAY, gain: 100 });
  });

  test('idle accounts take the load by weight once the busy ones run dry', () => {
    const subject = pool(
      [
        account({ authIndex: 'busy', remaining: 5 }),
        account({ authIndex: 'idle', remaining: 100, weight: 4 }),
      ],
      null
    );
    const result = projectPool(subject, {
      now: NOW,
      horizon: NOW + 10 * HOUR,
      stepMs: HOUR,
      shares: new Map([['busy', 10]]),
      demandScale: 2,
    });
    // 20%/h on 5% empties busy in 15 minutes; the rest of the demand moves to idle at once,
    // so the pool (405) serves all 20 pool %/h for the full ten hours.
    expect(result.firstEmpty?.account.authIndex).toBe('busy');
    expect(result.firstEmpty?.at).toBe(NOW + 15 * 60_000);
    expect(result.points[result.points.length - 1].value).toBeCloseTo(405 - 20 * 10);
    expect(result.drain.slice(1).every((point) => Math.abs(point.value - 20) < 1e-9)).toBe(true);
  });
});

describe('Lamplighter normalization', () => {
  test('reads Go zero times as unknown and keeps only usable weights', () => {
    const status = normalizeLamplighterStatus({
      now: '2026-10-26T12:00:00Z',
      last_poll: '0001-01-01T00:00:00Z',
      config: { account_weights: { 'claude-a.json': 5, 'claude-b.json': 0, bad: 'x' } },
      group_order: ['Claude'],
      accounts: [
        {
          auth_index: 'a',
          provider: 'claude',
          default_weight: 0,
          groups: [
            {
              key: 'k',
              source_label: 'Claude',
              windows: [
                { id: 'seven_day', short: '7d', kind: '7d', remaining: 140, reset: '' },
                { id: 'fable', kind: '', remaining: -3 },
              ],
            },
          ],
        },
        { provider: 'missing-index' },
      ],
    });
    expect(status.lastPoll).toBeNull();
    expect(status.accountWeights).toEqual({ 'claude-a.json': 5 });
    expect(status.accounts).toHaveLength(1);
    expect(status.accounts[0].defaultWeight).toBe(1);
    expect(status.accounts[0].groups[0].windows).toEqual([
      { id: 'seven_day', label: '7d', kind: '7d', remaining: 100, resetAt: null, observedAt: null },
      { id: 'fable', label: 'fable', kind: 'other', remaining: 0, resetAt: null, observedAt: null },
    ]);
  });

  test('turns point triples into sorted millisecond samples', () => {
    const history = normalizeLamplighterHistory({
      from: '2026-10-25T12:00:00Z',
      series: [
        { group: 'g', window: 'w', auth_index: 'a', points: [[20, 50, 1], [10, 60, 0], ['x']] },
      ],
    });
    expect(history.series[0].samples).toEqual([
      { at: 10_000, remaining: 60 },
      { at: 20_000, remaining: 50 },
    ]);
  });
});
