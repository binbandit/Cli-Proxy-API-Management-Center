// Installed plugin pages have independent login forms. Reuse only the active
// dashboard credential, in memory, after checking the loaded frame's origin/path.
const loginForms: Record<string, { input: string; form: string }> = {
  lamplighter: { input: '#key-input', form: '#key-form' },
  'claude-seat-pacer': { input: '#key-input', form: '#key-gate' },
  'github-copilot': { input: '#key', form: '#connection' },
};

export function signInPluginFrame(
  frame: HTMLIFrameElement,
  pluginID: string,
  managementKey: string,
  dashboardOrigin: string
): boolean {
  const selectors = loginForms[pluginID];
  if (!selectors || !managementKey) return false;
  try {
    const target = frame.contentWindow;
    if (!target) return false;
    const url = new URL(target.location.href);
    if (
      url.origin !== dashboardOrigin ||
      !url.pathname.startsWith(`/v0/resource/plugins/${encodeURIComponent(pluginID)}/`)
    )
      return false;
    const input = target.document.querySelector<HTMLInputElement>(selectors.input);
    const form = target.document.querySelector<HTMLFormElement>(selectors.form);
    if (!input || !form) return false;
    input.value = managementKey;
    form.requestSubmit();
    return true;
  } catch {
    // Cross-origin frames and unavailable plugin forms keep their normal login.
    return false;
  }
}
