#!/usr/bin/env bun
/**
 * 预热交互界面模块（App + REPL），首次运行可节省 1-3 分钟
 */
import { devStartupProgress } from '../src/utils/devStartupProgress.js'

devStartupProgress(8, '预热界面模块（仅首次较慢）…')
await import('../src/components/App.js')
devStartupProgress(12, 'App 模块已缓存…')
await import('../src/screens/REPL.js')
devStartupProgress(14, 'REPL 模块已缓存…')
