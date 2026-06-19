import { useState } from 'react'
import { ErrorBoundary } from './ErrorBoundary'
import { getFeatures, type FeatureModule } from './registry'

function FeaturePane({ feature }: { feature: FeatureModule }) {
  const { Component } = feature
  // optional features are sandboxed in their own boundary; core features have
  // no local boundary, so their crash bubbles to the root fatal boundary.
  if (feature.criticality === 'optional') {
    return (
      <ErrorBoundary scope="feature" featureId={feature.id} title={feature.title}>
        <Component />
      </ErrorBoundary>
    )
  }
  return <Component />
}

export function AppShell() {
  const features = getFeatures()
  const [activeId, setActiveId] = useState(features[0]?.id ?? '')
  const active = features.find((f) => f.id === activeId) ?? features[0]

  return (
    <ErrorBoundary scope="root">
      <div className="ccui-shell">
        <nav className="ccui-nav">
          {features.map((f) => (
            <button
              key={f.id}
              type="button"
              data-active={f.id === active?.id}
              onClick={() => setActiveId(f.id)}
            >
              {f.title}
            </button>
          ))}
        </nav>
        <main className="ccui-main">{active ? <FeaturePane feature={active} /> : null}</main>
      </div>
    </ErrorBoundary>
  )
}
