import { describe, expect, test } from 'bun:test';
import { signInPluginFrame } from '../src/features/plugins/pluginLogin';

const origin = 'https://proxy.example.ts.net';
function fixture(plugin = 'lamplighter', href = `${origin}/v0/resource/plugins/${plugin}/page`) {
  const input = { value: '' };
  let submitted = 0;
  const frame = {
    contentWindow: {
      location: { href },
      document: {
        querySelector(selector: string) {
          return ['#key-input', '#key'].includes(selector)
            ? input
            : {
                requestSubmit() {
                  submitted++;
                },
              };
        },
      },
    },
  } as unknown as HTMLIFrameElement;
  return { frame, input, submissions: () => submitted };
}

describe('plugin dashboard login handoff', () => {
  for (const id of ['lamplighter', 'claude-seat-pacer', 'github-copilot']) {
    test(`signs into ${id} with the current in-memory credential`, () => {
      const f = fixture(id);
      expect(signInPluginFrame(f.frame, id, 'test-key', origin)).toBe(true);
      expect(f.input.value).toBe('test-key');
      expect(f.submissions()).toBe(1);
    });
  }
  for (const href of [
    'https://elsewhere.example/v0/resource/plugins/lamplighter/page',
    `${origin}/v0/resource/plugins/lamplighter-other/page`,
    `${origin}/management.html`,
  ]) {
    test(`does not disclose a credential to ${href}`, () => {
      const f = fixture('lamplighter', href);
      expect(signInPluginFrame(f.frame, 'lamplighter', 'test-key', origin)).toBe(false);
      expect(f.input.value).toBe('');
      expect(f.submissions()).toBe(0);
    });
  }
  test('does nothing without an active login or supported plugin', () => {
    const f = fixture();
    expect(signInPluginFrame(f.frame, 'lamplighter', '', origin)).toBe(false);
    expect(signInPluginFrame(f.frame, 'unknown', 'test-key', origin)).toBe(false);
    expect(f.submissions()).toBe(0);
  });
  test('handles inaccessible cross-origin frames without interrupting the page', () => {
    const frame = {
      get contentWindow() {
        throw new Error('SecurityError');
      },
    } as HTMLIFrameElement;
    expect(signInPluginFrame(frame, 'lamplighter', 'test-key', origin)).toBe(false);
  });
});
