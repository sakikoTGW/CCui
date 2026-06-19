/**
 * Typed renderer store for React islands (P8).
 *
 * Single source of truth lives in vanilla `app/store.js` (zustand vanilla,
 * exposed as `window.ccuiStore`). Islands subscribe with selector-based,
 * type-safe re-renders via zustand's `useStore` over that shared instance —
 * no duplicate store, no state split.
 */
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand'

export interface Usage {
  input: number
  output: number
}

export interface PresetLike {
  id: string
  name: string
  [k: string]: unknown
}

/** Flat renderer state (kept flat for back-compat with 60+ vanilla call sites). */
export interface CcuiState {
  view: string
  busy: boolean
  daemonStatus: 'starting' | 'ready' | 'error' | string
  sessionRailCollapsed: boolean
  inspectorCollapsed: boolean
  model: string
  tier: string
  routeReason: string
  usage: Usage
  totalCost: number
  presets: PresetLike[]
  activePresetId: string | null
  templates: Array<{ id: string; name: string; [k: string]: unknown }>
  conversations: Array<{ id: string; [k: string]: unknown }>
  currentConversationId: string | null
  theme: string
  codingStyle: unknown
  comparePending: boolean
  activeSessionId: string
  orchBusy: boolean
  briefMode: boolean
  briefDiscoveryPending: boolean
  reviewPending: number
  projectName: string
  projectPath: string
}

export type CcuiStore = StoreApi<CcuiState>

let inert: CcuiStore | null = null
function inertStore(): CcuiStore {
  if (inert) return inert
  const state = {} as CcuiState
  inert = {
    getState: () => state,
    getInitialState: () => state,
    setState: () => {},
    subscribe: () => () => {},
  } as unknown as CcuiStore
  return inert
}

/** The shared canonical store, or an inert fallback if the host isn't ready. */
export function ccuiStore(): CcuiStore {
  return (
    (globalThis as unknown as { ccuiStore?: CcuiStore }).ccuiStore ?? inertStore()
  )
}

/**
 * Selector-based subscription. Re-renders only when the selected slice changes.
 *
 * @example const busy = useCcuiStore(s => s.busy)
 */
export function useCcuiStore<T>(selector: (s: CcuiState) => T): T {
  return useStore(ccuiStore(), selector)
}

/** Imperative patch for islands that need to write back to shared state. */
export function setCcuiState(
  patch: Partial<CcuiState> | ((s: CcuiState) => Partial<CcuiState>),
): void {
  const api = ccuiStore() as unknown as {
    set?: (p: unknown) => void
    setState?: (p: unknown, replace?: boolean) => void
  }
  if (api.set) api.set(patch)
  else if (api.setState) api.setState(patch)
}
