import { logForDebugging } from '../utils/debug.js'
import { isCcuiStackEnabled, isCcuiSubsystemEnabled, CCUI_SUBSYSTEM } from './config.js'
import { initCcuiHeadroom } from './headroom/compress.js'
import { initCcuiIngest } from './ingest/markitdown.js'
import { initCcuiMemory } from './memory/init.js'
import { initCcuiSkills } from './skills/context.js'
import { initCcuiStructure } from './structure/graphify.js'
import { initCcuiVault } from './vault/tolaria.js'

let initialized = false

/** 分层初始化：各子系统挂到各自扩展点，不合并进 memory */
export function initCcuiStack(): void {
  if (initialized || !isCcuiStackEnabled()) return
  initialized = true

  if (isCcuiSubsystemEnabled(CCUI_SUBSYSTEM.memory)) {
    initCcuiMemory()
  }
  if (isCcuiSubsystemEnabled(CCUI_SUBSYSTEM.structure)) {
    initCcuiStructure()
  }
  if (isCcuiSubsystemEnabled(CCUI_SUBSYSTEM.headroom)) {
    initCcuiHeadroom()
  }
  if (isCcuiSubsystemEnabled(CCUI_SUBSYSTEM.ingest)) {
    initCcuiIngest()
  }
  if (isCcuiSubsystemEnabled(CCUI_SUBSYSTEM.vault)) {
    initCcuiVault()
  }
  if (isCcuiSubsystemEnabled(CCUI_SUBSYSTEM.skills)) {
    initCcuiSkills()
  }

  logForDebugging('[ccui] stack initialized (layered)', { level: 'info' })
}
