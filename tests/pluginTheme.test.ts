import { describe, expect, test } from 'bun:test';
import { buildPluginThemeCss, syncPluginTheme } from '../src/features/plugins/pluginTheme';

const origin = 'https://proxy.example.ts.net';
const tokens: Record<string, string> = {
  '--bg-secondary': '#0a0a0a',
  '--bg-primary': '#121212',
  '--text-primary': '#f5f5f5',
};
const read = (token: string) => tokens[token] ?? '';

describe('plugin theme handoff', () => {
  test('overrides shared and plugin-specific tokens with the live dashboard values', () => {
    const css = buildPluginThemeCss(read);
    expect(css).toContain('--bg-secondary: #0a0a0a !important;');
    // Seat Pacer's own vocabulary follows the same values.
    expect(css).toContain('--plane: #0a0a0a !important;');
    expect(css).toContain('--surface-1: #121212 !important;');
    expect(css).toContain('--ink-1: #f5f5f5 !important;');
    // Tokens the dashboard does not define are left to the plugin.
    expect(css).not.toContain('--bg-tertiary');
  });

  test('refuses frames outside the plugin resource path and cross-origin frames', () => {
    const frame = (href: string) =>
      ({
        contentWindow: {
          location: { href },
          document: {
            head: {},
            getElementById: () => {
              throw new Error('must not touch the document');
            },
          },
        },
      }) as unknown as HTMLIFrameElement;
    expect(
      syncPluginTheme(
        frame('https://elsewhere.example/v0/resource/plugins/lamplighter/page'),
        'lamplighter',
        origin
      )
    ).toBe(false);
    expect(syncPluginTheme(frame(`${origin}/management.html`), 'lamplighter', origin)).toBe(false);
    const blocked = {
      get contentWindow() {
        throw new Error('SecurityError');
      },
    } as HTMLIFrameElement;
    expect(syncPluginTheme(blocked, 'lamplighter', origin)).toBe(false);
  });
});
