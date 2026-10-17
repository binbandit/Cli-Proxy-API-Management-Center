const PREFIX_BYTES = 2048;

export function parseDashboardBuild(html: string): string | null {
  // This marker is inserted at the beginning of <head> by the build.
  return html.match(/<meta name="cliproxy-build" content="([a-f0-9-]{36})">/)?.[1] ?? null;
}

export async function fetchDashboardBuild(
  url: string,
  signal: AbortSignal
): Promise<string | null> {
  // The backend serves byte ranges, so polling doesn't download the bundled app.
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Range: `bytes=0-${PREFIX_BYTES - 1}` },
    signal,
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let html = '';
  let bytes = 0;
  try {
    // Also bound consumption when a reverse proxy ignores the Range header.
    while (bytes < PREFIX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, PREFIX_BYTES - bytes);
      html += decoder.decode(chunk, { stream: true });
      bytes += chunk.length;
      const build = parseDashboardBuild(html);
      if (build) return build;
    }
    return parseDashboardBuild(html);
  } finally {
    await reader.cancel();
  }
}
