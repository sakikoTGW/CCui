import { createElement, type ReactNode } from 'react'
import { ThemeProvider } from '../components/design-system/ThemeProvider.js'
import inkRender, {
  type Instance,
  createRoot as inkCreateRoot,
  type RenderOptions,
  type Root,
} from './root.js'

export type { RenderOptions, Instance, Root }

// Wrap all CC render calls with ThemeProvider so ThemedBox/ThemedText work
// without every call site having to mount it. Ink itself is theme-agnostic.
function withTheme(node: ReactNode): ReactNode {
  return createElement(ThemeProvider, null, node)
}

export async function render(
  node: ReactNode,
  options?: NodeJS.WriteStream | RenderOptions,
): Promise<Instance> {
  return inkRender(withTheme(node), options)
}

export async function createRoot(options?: RenderOptions): Promise<Root> {
  const root = await inkCreateRoot(options)
  return {
    ...root,
    render: node => root.render(withTheme(node)),
  }
}

export { color } from '../components/design-system/color.js'
export type { Props as BoxProps } from '../components/design-system/ThemedBox.js'
export { default as Box } from '../components/design-system/ThemedBox.js'
export type { Props as TextProps } from '../components/design-system/ThemedText.js'
export { default as Text } from '../components/design-system/ThemedText.js'
export {
  ThemeProvider,
  usePreviewTheme,
  useTheme,
  useThemeSetting,
} from '../components/design-system/ThemeProvider.js'
export { Ansi } from './Ansi.js'
export type { Props as AppProps } from './components/AppContext.js'
export type { Props as BaseBoxProps } from './components/Box.js'
export { default as BaseBox } from './components/Box.js'
export type {
  ButtonState,
  Props as ButtonProps,
} from './components/Button.js'
export { default as Button } from './components/Button.js'
export type { Props as LinkProps } from './components/Link.js'
export { default as Link } from './components/Link.js'
export type { Props as NewlineProps } from './components/Newline.js'
export { default as Newline } from './components/Newline.js'
export { NoSelect } from './components/NoSelect.js'
export { RawAnsi } from './components/RawAnsi.js'
export { default as Spacer } from './components/Spacer.js'
export type { Props as StdinProps } from './components/StdinContext.js'
export type { Props as BaseTextProps } from './components/Text.js'
export { default as BaseText } from './components/Text.js'
export type { DOMElement } from './dom.js'
export { ClickEvent } from './events/click-event.js'
export { EventEmitter } from './events/emitter.js'
export { Event } from './events/event.js'
export type { Key } from './events/input-event.js'
export { InputEvent } from './events/input-event.js'
export type { TerminalFocusEventType } from './events/terminal-focus-event.js'
export { TerminalFocusEvent } from './events/terminal-focus-event.js'
export { FocusManager } from './focus.js'
export type { FlickerReason } from './frame.js'
export { useAnimationFrame } from './hooks/use-animation-frame.js'
export { default as useApp } from './hooks/use-app.js'
export { default as useInput } from './hooks/use-input.js'
export { useAnimationTimer, useInterval } from './hooks/use-interval.js'
export { useSelection } from './hooks/use-selection.js'
export { default as useStdin } from './hooks/use-stdin.js'
export { useTabStatus } from './hooks/use-tab-status.js'
export { useTerminalFocus } from './hooks/use-terminal-focus.js'
export { useTerminalTitle } from './hooks/use-terminal-title.js'
export { useTerminalViewport } from './hooks/use-terminal-viewport.js'
export { default as measureElement } from './measure-element.js'
export { supportsTabStatus } from './termio/osc.js'
export { default as wrapText } from './wrap-text.js'
