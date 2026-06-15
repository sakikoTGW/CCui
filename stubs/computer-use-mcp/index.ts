export type ComputerExecutor = Record<string, unknown>
export type DisplayGeometry = Record<string, unknown>
export type FrontmostApp = Record<string, unknown>
export type InstalledApp = Record<string, unknown>
export type ResolvePrepareCaptureResult = Record<string, unknown>
export type RunningApp = Record<string, unknown>
export type ScreenshotResult = Record<string, unknown>
export type ComputerUseSessionContext = Record<string, unknown>
export type CuCallToolResult = Record<string, unknown>
export type CuPermissionRequest = Record<string, unknown>
export type CuPermissionResponse = Record<string, unknown>
export type ScreenshotDims = Record<string, unknown>

export const DEFAULT_GRANT_FLAGS = {}
export const API_RESIZE_PARAMS = {}
export function targetImageSize(): { width: number; height: number } {
  return { width: 1280, height: 720 }
}

export function buildComputerUseTools(): unknown[] {
  return []
}

export async function createComputerUseMcpServer(): Promise<{ close: () => Promise<void> }> {
  return { close: async () => {} }
}

export function bindSessionContext(): void {}
