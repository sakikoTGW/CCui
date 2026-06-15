#!/usr/bin/env bun
/**
 * 开发环境一次性种子：信任当前目录、跳过引导，开箱即用
 */
import { setSessionTrustAccepted } from '../src/bootstrap/state.js'
import { CCUI_DEFAULT_FEATURE_OVERRIDES } from '../src/ccui/memory/config.js'
import { normalizeApiKeyForConfig } from '../src/utils/authPortable.js'
import {
  checkHasTrustDialogAccepted,
  enableConfigs,
  getCustomApiKeyStatus,
  getGlobalConfig,
  saveCurrentProjectConfig,
  saveGlobalConfig,
} from '../src/utils/config.js'
import { loadDotEnv } from './loadEnv.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
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

if (process.env.ANTHROPIC_API_KEY) {
  const truncated = normalizeApiKeyForConfig(process.env.ANTHROPIC_API_KEY)
  if (getCustomApiKeyStatus(truncated) === 'new') {
    saveGlobalConfig(current => ({
      ...current,
      customApiKeyResponses: {
        ...current.customApiKeyResponses,
        approved: [...(current.customApiKeyResponses?.approved ?? []), truncated],
      },
    }))
  }
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

spawnSync(
  process.execPath,
  [
    '--define',
    'MACRO.VERSION="2.0.0-dev"',
    join(root, 'scripts/seed-ccui-skills.ts'),
  ],
  { cwd: root, stdio: 'inherit', shell: false },
)
