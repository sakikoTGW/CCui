/**
 * Bridge to the vanilla renderer store (app/store.js), exposed on window by
 * renderer.js during the islands migration. Lets React islands read/write the
 * shared reactive store so the still-vanilla parts (inspector, hotkeys) stay in
 * sync. Removed in P8 when state unifies under zustand.
 */

export interface RendererState {
  activePresetId: string | null
  presets: Array<{ id: string; name: string; [k: string]: unknown }>
  [k: string]: unknown
}

export interface RendererStore {
  get(): RendererState
  set(patch: Partial<RendererState> | ((s: RendererState) => RendererState)): void
  subscribe(fn: (s: RendererState) => void): () => void
}

export function getStore(): RendererStore | undefined {
  return (globalThis as unknown as { ccuiStore?: RendererStore }).ccuiStore
}

type ToastFn = (msg: string, opts?: { type?: 'success' | 'error' | 'warn' | 'info' }) => void

export function toast(msg: string, opts?: { type?: 'success' | 'error' | 'warn' | 'info' }): void {
  const fn = (globalThis as unknown as { ccuiToast?: ToastFn }).ccuiToast
  if (fn) fn(msg, opts)
}
