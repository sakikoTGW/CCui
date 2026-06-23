/**
 * GUI daemon 开发环境引导：信任目录、记忆/栈开关、分层初始化。
 * CLI REPL 走 seed-dev.ts；桌面端走本模块（start-gui.bat 也会先跑 seed-dev）。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDotEnv } from '../../scripts/loadEnv.js'
import {
  setOriginalCwd,
  setProjectRoot,
  setSessionTrustAccepted,
  checkHasTrustDialogAccepted,
  enableConfigs,
  getGlobalConfig,
  saveCurrentProjectConfig,
  saveGlobalConfig,
} from '@ccui/engine-api'
import { initCcuiStack, CCUI_DEFAULT_FEATURE_OVERRIDES } from '@ccui/engine-memory'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

let bootstrapped = false

export async function bootstrapGuiDev(cwd = process.cwd()): Promise<void> {
  if (bootstrapped) return
  bootstrapped = true

  process.env.CLAUDE_CODE_DEV ??= '1'
  process.env.CCUI_STACK ??= '1'
  process.env.CCUI_MEMORY ??= '1'

  loadDotEnv(root)
  enableConfigs()

  const config = getGlobalConfig()
  if (!config.theme || !config.hasCompletedOnboarding) {
    saveGlobalConfig(current => ({
      ...current,
      hasCompletedOnboarding: true,
      lastOnboardingVersion: process.env.MACRO_VERSION ?? '2.0.0-dev',
      theme: current.theme ?? 'dark',
    }))
  }

  if (!checkHasTrustDialogAccepted()) {
    saveCurrentProjectConfig(current => ({
      ...current,
      hasTrustDialogAccepted: true,
    }))
    setSessionTrustAccepted(true)
  }

  saveGlobalConfig(current => ({
    ...current,
    autoMemoryEnabled: true,
    autoCompactEnabled: true,
    cachedGrowthBookFeatures: {
      ...current.cachedGrowthBookFeatures,
      ...CCUI_DEFAULT_FEATURE_OVERRIDES,
    },
  }))

  setOriginalCwd(cwd)
  setProjectRoot(cwd)
  initCcuiStack()
}

/** 热切换项目根 — 不重置 bootstrapped 标志 */
export async function applyProjectRoot(cwd: string): Promise<void> {
  loadDotEnv(root)
  setOriginalCwd(cwd)
  setProjectRoot(cwd)
}
