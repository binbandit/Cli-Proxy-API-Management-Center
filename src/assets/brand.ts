/** Product name and mark shown in the shell, login and about pages. */
export const BRAND_NAME = 'prox';

// Mark designed with Codex: a request path forking toward the selected account (amber).
// index.html carries the same SVG as its favicon so the tab icon is right before JS runs.
const BRAND_LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="0.5" y="0.5" width="63" height="63" rx="15.5" fill="#171717" stroke="#343434"/><path d="M25 32C34 32 32 44 40 44H47" fill="none" stroke="#858585" stroke-width="8" stroke-linecap="round"/><path d="M16 32H25C34 32 32 20 40 20H47" fill="none" stroke="#f5f5f5" stroke-width="8" stroke-linecap="round"/><rect x="39" y="16" width="12" height="8" rx="4" fill="#f59e0b"/></svg>';

export const BRAND_LOGO_URL = `data:image/svg+xml,${encodeURIComponent(BRAND_LOGO_SVG)}`;
