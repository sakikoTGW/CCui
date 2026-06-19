import { useState } from 'react'
import { registerFeature } from '../shell/registry'

// Demo features exercising the fault-isolation model. Replaced by real
// migrated features in P5; kept minimal here to validate the boundaries.

function CoreHome() {
  return (
    <section>
      <h2>首页(核心)</h2>
      <p>核心模块。若它在渲染中抛错,会冒泡到根边界并显示全屏致命页。</p>
    </section>
  )
}

function CrashyOptional() {
  const [boom, setBoom] = useState(false)
  if (boom) throw new Error('可选模块故意崩溃,验证故障隔离')
  return (
    <section>
      <h2>实验模块(可选)</h2>
      <p>点下面的按钮让它崩溃 —— 只有这块变灰,其他模块照常用。</p>
      <button type="button" onClick={() => setBoom(true)}>
        触发崩溃
      </button>
    </section>
  )
}

export function registerDemoFeatures(): void {
  registerFeature({ id: 'home', title: '首页', criticality: 'core', order: 0, Component: CoreHome })
  registerFeature({
    id: 'lab',
    title: '实验',
    criticality: 'optional',
    order: 10,
    Component: CrashyOptional,
  })
}
