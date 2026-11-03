// Installed plugin pages ship a frozen copy of the dashboard's theme tokens, so they keep
// the old palette. Push the dashboard's live values into the loaded frame, after the same
// origin/path check the login handoff uses, so plugins follow the current theme.

/** Tokens plugins copy from the dashboard under the same names (Lamplighter, for one). */
const SHARED_TOKENS = [
  '--bg-primary',
  '--bg-secondary',
  '--bg-tertiary',
  '--bg-hover',
  '--bg-quinary',
  '--floating-surface',
  '--floating-shadow',
  '--text-primary',
  '--text-secondary',
  '--text-tertiary',
  '--text-quaternary',
  '--text-muted',
  '--border-color',
  '--border-secondary',
  '--border-primary',
  '--border-hover',
  '--primary-color',
  '--primary-hover',
  '--primary-active',
  '--primary-contrast',
  '--success-color',
  '--error-color',
  '--warning-color',
  '--danger-color',
  '--warning-bg',
  '--warning-border',
  '--warning-text',
  '--success-badge-bg',
  '--success-badge-text',
  '--success-badge-border',
  '--failure-badge-bg',
  '--failure-badge-text',
  '--failure-badge-border',
  '--count-badge-bg',
  '--count-badge-text',
  '--viz-success',
  '--viz-failure',
  '--shadow',
  '--shadow-lg',
] as const;

/** Plugin vocabularies with their own names, mapped to the dashboard token they stand for. */
const ALIASED_TOKENS: readonly (readonly [plugin: string, dashboard: string])[] = [
  // Claude Seat Pacer
  ['--plane', '--bg-secondary'],
  ['--surface-1', '--bg-primary'],
  ['--surface-2', '--bg-tertiary'],
  ['--ink-1', '--text-primary'],
  ['--ink-2', '--text-secondary'],
  ['--ink-3', '--text-tertiary'],
  ['--rule', '--border-color'],
];

const STYLE_ID = 'prox-dashboard-theme';

/**
 * Stylesheet that overrides the plugin's token values. `!important` wins over the plugin's
 * own `:root[data-theme]` blocks whatever their specificity; tokens the dashboard does not
 * define are left alone.
 */
export function buildPluginThemeCss(read: (token: string) => string): string {
  const declarations = [
    ...SHARED_TOKENS.map((token) => [token, token] as const),
    ...ALIASED_TOKENS,
  ].flatMap(([target, source]) => {
    const value = read(source).trim();
    return value ? [`${target}: ${value} !important;`] : [];
  });
  return `:root { ${declarations.join(' ')} }`;
}

export function syncPluginTheme(
  frame: HTMLIFrameElement,
  pluginID: string,
  dashboardOrigin: string
): boolean {
  try {
    const target = frame.contentWindow;
    if (!target) return false;
    const url = new URL(target.location.href);
    if (
      url.origin !== dashboardOrigin ||
      !url.pathname.startsWith(`/v0/resource/plugins/${encodeURIComponent(pluginID)}/`)
    )
      return false;
    const doc = target.document;
    if (!doc.head) return false;
    const computed = window.getComputedStyle(document.documentElement);
    let style = doc.getElementById(STYLE_ID);
    if (!style) {
      style = doc.createElement('style');
      style.id = STYLE_ID;
      doc.head.appendChild(style);
    }
    style.textContent = buildPluginThemeCss((token) => computed.getPropertyValue(token));
    return true;
  } catch {
    // Cross-origin frames keep their own colors.
    return false;
  }
}
