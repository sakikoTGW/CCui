import type { ComponentType } from 'react'

export type FeatureCriticality = 'core' | 'optional'

export interface FeatureModule {
  /** stable unique id, e.g. "chat", "review" */
  id: string
  /** human label shown in nav / error cards */
  title: string
  /**
   * core   -> crash bubbles to root boundary (full-screen fatal)
   * optional -> crash is contained inline; rest of app survives
   */
  criticality: FeatureCriticality
  /** render order, lower first */
  order?: number
  Component: ComponentType
}

const registry = new Map<string, FeatureModule>()

export function registerFeature(feature: FeatureModule): void {
  if (registry.has(feature.id)) {
    throw new Error(`Feature id duplicated: ${feature.id}`)
  }
  registry.set(feature.id, feature)
}

export function getFeatures(): FeatureModule[] {
  return [...registry.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}

export function getFeature(id: string): FeatureModule | undefined {
  return registry.get(id)
}

/** test-only: wipe the registry */
export function __resetRegistry(): void {
  registry.clear()
}
