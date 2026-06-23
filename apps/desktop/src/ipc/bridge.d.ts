import type { DaemonMessage } from '@ccui/protocol'

export interface CollabPeer {
  userId: string
  name: string
}
export interface CollabState {
  status: string
  room: string
  selfId: string
  peers: CollabPeer[]
  logs: { t: string; msg: string }[]
}

export interface BgPrefs {
  mode: 'default' | 'color' | 'image'
  color?: string
  image?: string
  overlay?: number
  blur?: number
}
export type TextColorSet = Record<string, string | null>
export interface Personalize {
  accent: string | null
  bg: BgPrefs
  fontFamily: string | null
  adaptiveText: boolean
  textColors?: { light?: TextColorSet; dark?: TextColorSet }
}
export interface ChromePrefs {
  showProject?: boolean
  showSession?: boolean
  showTheme?: boolean
  showConnection?: boolean
  [k: string]: unknown
}

/**
 * Shape of the `window.ccui` bridge exposed by preload.js (contextIsolation safe).
 * Kept in sync with apps/desktop/preload.js. Renderer code must go through the
 * typed client in ./client.ts rather than touching this global directly.
 */
export interface CcuiBridge {
  send(text: string, opts?: {
    taskType?: string
    model?: string
    systemPrompt?: string
    sessionId?: string
  }): void
  respondPermission(id: string, allow: boolean, updatedInput?: unknown, sessionId?: string): void
  interrupt(sessionId?: string): void
  reset(sessionId?: string): void
  hydrateSession(sessionId: string, payload: Record<string, unknown>): void
  setEnv(patch: Record<string, unknown>): void
  request(payload: Record<string, unknown>): void
  setRouter(patch: Record<string, unknown>): void
  collabPort(): Promise<number>
  exportPdf(html: string, title: string): Promise<unknown>
  pushReviewQueue(items: unknown[]): void
  openReviewWindow(): void
  openHarnessWindow(): void
  openLauncherWindow(): void
  enterWorkspace(payload?: { newConvo?: boolean; prompt?: string; convoId?: string; send?: boolean }): void
  onEnterWorkspace(cb: (payload: { newConvo?: boolean; prompt?: string; convoId?: string }) => void): () => void
  reviewAction(payload: unknown): void
  onReviewQueue(cb: (items: unknown[]) => void): () => void
  onReviewAction(cb: (payload: unknown) => void): () => void
  getPathForFile(file: File): string
  onDaemon(cb: (msg: DaemonMessage) => void): () => void
  onLog(cb: (text: string) => void): () => void
  reportDiag(level: string, source: string, message: string, detail?: unknown): void
  getProjects(): Promise<unknown>
  pickProject(): Promise<unknown>
  switchProject(projectPath: string): Promise<unknown>
  pinProject(projectPath: string, pinned: boolean): Promise<unknown>
  removeProject(projectPath: string): Promise<unknown>
  openInExplorer(projectPath: string): Promise<unknown>
  onProjectChanged(cb: (payload: unknown) => void): () => void
  getWindowChrome(): Promise<unknown>
  setWindowChrome(patch: Record<string, unknown>): Promise<unknown>
  windowMinimize(): Promise<unknown>
  windowMaximize(): Promise<unknown>
  windowClose(): Promise<unknown>
  isWindowMaximized(): Promise<boolean>
  onWindowChrome(cb: (payload: unknown) => void): () => void
  onWindowMaximized(cb: (v: boolean) => void): () => void
  onWindowChromeAnim(cb: (payload: unknown) => void): () => void
  listFonts(): Promise<unknown>
  pickFiles(): Promise<string[]>
  pickDir(): Promise<string | null>
  saveClipboardImage(): Promise<string | null>
}

declare global {
  interface Window {
    ccui: CcuiBridge
    ccuiDiag?: { reportError?: (e: unknown) => void }
    ccuiStore?: unknown
    ccuiToast?: (msg: string, opts?: { type?: string }) => void
    ccuiReview?: {
      getAll(): unknown[]
      respondBatch(ids: string[], allow: boolean, opts?: { alwaysAllow?: boolean }): void
    }
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
    ccuiCollab?: {
      getState(): CollabState
      subscribe(fn: (s: CollabState) => void): () => void
      join(room: string): Promise<void>
      leave(): void
    }
    ccuiStudio?: {
      branchSvg(convo: unknown): string
      branchTree(el: HTMLElement, convo: unknown): void
      registerOverlay(el: HTMLElement, onClose: () => void): () => void
      openConversation(convo: unknown): void
      exportAll(): Promise<unknown>
      importAll(payload: unknown): Promise<void>
    }
    ccuiPerms?: {
      groups: { id: string; label: string; tools: string[] }[]
      explain: string
      get(): Promise<string[]>
      save(list: string[]): Promise<string[]>
    }
    ccuiPersonalize?: {
      get(): Personalize
      apply(prefs: Personalize): void
      save(prefs: Personalize): Promise<Personalize>
      defaults(): Personalize
      deriveAccentWeak(accent: string, dark: boolean): string | null
      textParts: { key: string; label: string; cssVar: string }[]
      getDefaultTextColor(partKey: string, mode: 'light' | 'dark'): string
    }
    ccuiChrome?: {
      get(): ChromePrefs
      save(patch: Partial<ChromePrefs>): Promise<{ chrome?: ChromePrefs; degraded?: boolean } | undefined>
    }
    ccuiWelcome?: () => void
  }
}

export {}
