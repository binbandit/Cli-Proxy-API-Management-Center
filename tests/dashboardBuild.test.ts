import { afterEach, describe, expect, test } from 'bun:test';
import { fetchDashboardBuild, parseDashboardBuild } from '../src/services/dashboardBuild';

const build = 'b3a17bda-15d9-4677-a603-567350660e0b';
const marker = `<meta name="cliproxy-build" content="${build}">`;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('dashboard deployment marker', () => {
  test('recognizes the marker without mistaking an error page for a new build', () => {
    expect(parseDashboardBuild(`<html><head>${marker}`)).toBe(build);
    expect(parseDashboardBuild('<html>gateway unavailable</html>')).toBeNull();
    expect(parseDashboardBuild('<meta name="cliproxy-build" content="oops">')).toBeNull();
  });

  test('requests a small uncached range and reads markers across network chunks', async () => {
    let cancelled = false;
    let request: RequestInit | undefined;
    let chunk = 0;
    globalThis.fetch = (async (_url, init) => {
      request = init;
      return new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(
              new TextEncoder().encode(chunk++ === 0 ? marker.slice(0, 20) : marker.slice(20))
            );
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 206, headers: { 'content-type': 'text/html; charset=utf-8' } }
      );
    }) as typeof fetch;
    expect(await fetchDashboardBuild('/management.html', new AbortController().signal)).toBe(build);
    expect(request?.cache).toBe('no-store');
    expect(request?.headers).toEqual({ Range: 'bytes=0-2047' });
    expect(cancelled).toBe(true);
  });

  test('stops reading when a proxy ignores the range, and ignores error responses', async () => {
    globalThis.fetch = (async () =>
      new Response(' '.repeat(2048) + marker, {
        headers: { 'content-type': 'text/html' },
      })) as typeof fetch;
    expect(await fetchDashboardBuild('/management.html', new AbortController().signal)).toBeNull();
    globalThis.fetch = (async () =>
      new Response(marker, {
        status: 503,
        headers: { 'content-type': 'text/html' },
      })) as typeof fetch;
    expect(await fetchDashboardBuild('/management.html', new AbortController().signal)).toBeNull();
  });
});
