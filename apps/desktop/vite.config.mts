import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cssInjected from 'vite-plugin-css-injected-by-js'
import { resolve } from 'node:path'

// Islands build (strangler-fig migration): the vanilla renderer.js is the host;
// migrated React features are bundled into dist/islands.js (ESM) and dynamically
// imported by the vanilla view shims. React is bundled in (host has no bundler);
// CSS Modules are injected by JS so islands need no extra <link> under file://.
//
// .mts so Vite loads this config as ESM (the css-injected plugin is ESM-only,
// and the package has no "type":"module" to keep main.js/preload.js as CJS).
export default defineConfig({
  root: __dirname,
  plugins: [react(), cssInjected()],
  // lib 模式不会自动替换 process.env.NODE_ENV，而 React 依赖它；renderer 无 node
  // 全局 process，不替换会运行时报 "process is not defined"。
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  resolve: {
    alias: {
      '@ccui/protocol': resolve(__dirname, '../../packages/protocol/index.ts'),
      '@ccui/plugin-sdk': resolve(__dirname, '../../packages/plugin-sdk/index.ts'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/islands.ts'),
      formats: ['es'],
      fileName: () => 'islands.js',
    },
  },
})
