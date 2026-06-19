/**
 * Accessors for vanilla host helpers exposed on window by renderer.js during the
 * islands migration (confirm popover / theme apply / brief schema). Single source
 * of truth stays in vanilla; islands call through here. Removed once the host is
 * fully React (P5d/P8).
 */

type W = typeof globalThis & {
  ccuiConfirm?: (anchorEl: Element, message: string, onConfirm: () => void) => void
  ccuiTheme?: {
    applyTheme(name: string, vars?: Record<string, string> | null): Promise<void>
    builtins: Record<string, Record<string, string>>
  }
  ccuiBrief?: {
    normalize(raw: unknown): Record<string, unknown>
    assess(b: unknown): { pct: number; ready: boolean; score: number; total: number }
    domainLabels(ids: string[]): string[]
  }
}

export function confirmPopover(anchorEl: Element | null | undefined, message: string, onConfirm: () => void): void {
  const fn = (globalThis as W).ccuiConfirm
  if (fn && anchorEl) fn(anchorEl, message, onConfirm)
  else onConfirm()
}

export function hostTheme() {
  return (globalThis as W).ccuiTheme
}

export function hostBrief() {
  return (globalThis as W).ccuiBrief
}

export function hostCollab() {
  return (globalThis as unknown as { ccuiCollab?: Window['ccuiCollab'] }).ccuiCollab
}

export function hostStudio() {
  return (globalThis as unknown as { ccuiStudio?: Window['ccuiStudio'] }).ccuiStudio
}

export function hostPerms() {
  return (globalThis as unknown as { ccuiPerms?: Window['ccuiPerms'] }).ccuiPerms
}

export function hostPersonalize() {
  return (globalThis as unknown as { ccuiPersonalize?: Window['ccuiPersonalize'] }).ccuiPersonalize
}

export function hostChrome() {
  return (globalThis as unknown as { ccuiChrome?: Window['ccuiChrome'] }).ccuiChrome
}

export function hostWelcome() {
  return (globalThis as unknown as { ccuiWelcome?: Window['ccuiWelcome'] }).ccuiWelcome
}
