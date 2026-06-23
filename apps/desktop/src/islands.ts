/**
 * Islands entry — built by Vite (lib mode) into dist/islands.js.
 *
 * The remaining vanilla renderer (apps/desktop/renderer.js + app/views/*.js)
 * is the host. Migrated features are React islands mounted into a view's
 * container via these mount functions. Each island is wrapped in a feature-level
 * ErrorBoundary so a crash stays contained and never takes down the vanilla shell.
 */
import { createElement, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ErrorBoundary } from './shell/ErrorBoundary'
import { bus } from './shell/bus'

export { bus } from './shell/bus'
export type { BusEvents, BusEvent } from './shell/bus'

/** Expose the typed bus to the vanilla host so both worlds share one transport. */
export function installBus(): typeof bus {
  ;(globalThis as unknown as { ccuiBus?: typeof bus }).ccuiBus = bus
  return bus
}
import { TemplatesView } from './features/templates/TemplatesView'
import { PresetsView } from './features/presets/PresetsView'
import { ContextMapView } from './features/map/ContextMapView'
import { ProjectsView } from './features/projects/ProjectsView'
import { ConsoleView } from './features/console/ConsoleView'
import { ReviewView } from './features/review/ReviewView'
import { OrchestrateView } from './features/orchestrate/OrchestrateView'
import { BriefLibraryView } from './features/brief/BriefLibraryView'
import { ThemeEditorView } from './features/theme/ThemeEditorView'
import { CollabView } from './features/collab/CollabView'
import { StudioView } from './features/studio/StudioView'
import { SettingsView } from './features/settings/SettingsView'
import { PluginHost } from './features/plugins/PluginHost'
import { CaptureView } from './features/capture/CaptureView'
import { CapabilitiesView } from './features/capabilities/CapabilitiesView'
import { PackView } from './features/packs/PackView'
import { HarnessView } from './features/harness/HarnessView'
import { LauncherApp } from './features/launcher/LauncherApp'

export type IslandUnmount = () => void

function mountIsland(
  el: HTMLElement,
  featureId: string,
  title: string,
  Component: ComponentType,
): IslandUnmount {
  const root: Root = createRoot(el)
  root.render(
    createElement(ErrorBoundary, {
      scope: 'feature',
      featureId,
      title,
      children: createElement(Component),
    }),
  )
  return () => root.unmount()
}

export function mountTemplates(el: HTMLElement): IslandUnmount {
  return mountIsland(el, 'templates', '提示词模板', TemplatesView)
}

export function mountPresets(el: HTMLElement): IslandUnmount {
  return mountIsland(el, 'presets', '参数预设', PresetsView)
}

export function mountContextMap(el: HTMLElement): IslandUnmount {
  return mountIsland(el, 'map', '项目结构图', ContextMapView)
}

export function mountProjects(el: HTMLElement): IslandUnmount {
  return mountIsland(el, 'projects', '项目', ProjectsView)
}

export function mountConsole(el: HTMLElement): IslandUnmount {
  return mountIsland(el, 'console', '控制台', ConsoleView)
}

export function mountReview(el: HTMLElement): IslandUnmount {
  return mountIsland(el, 'review', '变更审查', ReviewView)
}

export function mountOrchestrate(el: HTMLElement): IslandUnmount {
  return mountIsland(el, 'orchestrate', 'Compare', OrchestrateView)
}

export function mountBriefLibrary(el: HTMLElement): IslandUnmount {
  return mountIsland(el, 'brief', '简报库', BriefLibraryView)
}

export function mountThemeEditor(el: HTMLElement): IslandUnmount {
  return mountIsland(el, 'theme', '主题编辑器', ThemeEditorView)
}

export function mountCollab(el: HTMLElement): IslandUnmount {
  return mountIsland(el, 'collab', '协作空间', CollabView)
}

export function mountStudio(el: HTMLElement): IslandUnmount {
  return mountIsland(el, 'studio', '数据工作室', StudioView)
}

export function mountSettings(el: HTMLElement): IslandUnmount {
  return mountIsland(el, 'settings', '设置', SettingsView)
}

export function mountPlugins(el: HTMLElement): IslandUnmount {
  return mountIsland(el, 'plugins', '扩展', PluginHost)
}

export function mountCapture(el: HTMLElement): IslandUnmount {
  return mountIsland(el, 'capture', '抓包克隆', CaptureView)
}

export function mountCapabilities(el: HTMLElement): IslandUnmount {
  return mountIsland(el, 'capabilities', '装备 / 能力', CapabilitiesView)
}

export function mountPacks(el: HTMLElement): IslandUnmount {
  return mountIsland(el, 'packs', '整合包', PackView)
}

export function mountHarness(el: HTMLElement): IslandUnmount {
  return mountIsland(el, 'harness', 'Harness', HarnessView)
}

export function mountLauncher(el: HTMLElement): IslandUnmount {
  return mountIsland(el, 'launcher', '主页', LauncherApp)
}
