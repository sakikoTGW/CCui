// Electron 主进程：窗口 + daemon + 协作 WebSocket + PDF 导出 + 变更审查窗
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron')
const { spawn, execSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')
const { createProjectsStore } = require('./projects-store.js')
const { createChromeStore } = require('./chrome-store.js')

const ROOT = path.join(__dirname, '..', '..')
const DAEMON = path.join(ROOT, 'services', 'daemon', 'daemon.ts')
const COLLAB_PORT = 4177
const diag = require('./diag-log.js')

diag.initMainDiag()

function resolveBun() {
  const candidates = [
    process.env.BUN_PATH,
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'bun', 'bin', 'bun.exe'),
    path.join(process.env.USERPROFILE || '', '.bun', 'bin', 'bun.exe'),
  ].filter(Boolean)
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c } catch {}
  }
  return null
}

/** @param {import('electron').BrowserWindow|null|undefined} w */
function safeSend(w, channel, payload) {
  try {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  } catch {}
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

let win = null
let reviewWin = null
let harnessWin = null
let launcherWin = null
let daemon = null
let chromeStore = null
let stdoutBuf = ''
/** @type {ReturnType<typeof createProjectsStore> | null} */
let projectsStore = null
/** @type {import('ws').WebSocketServer | null} */
let wss = null
const rooms = new Map() // roomId -> Map<userId, { ws, name }>
let reviewQueueSnapshot = []

function startCollabServer() {
  try {
    const WebSocket = require('ws')
    const server = http.createServer()
    wss = new WebSocket.Server({ server })
    wss.on('connection', ws => {
      let meta = { room: '', userId: '', name: '' }
      ws.on('message', raw => {
        let msg
        try { msg = JSON.parse(String(raw)) } catch { return }
        if (msg.type === 'join') {
          meta = { room: msg.room || 'default', userId: msg.userId, name: msg.name || 'anon' }
          if (!rooms.has(meta.room)) rooms.set(meta.room, new Map())
          rooms.get(meta.room).set(meta.userId, { ws, name: meta.name })
          broadcastPeers(meta.room)
          return
        }
        if (!meta.room) return
        const payload = { ...msg, from: meta.userId, fromName: meta.name }
        for (const [uid, peer] of rooms.get(meta.room) || []) {
          if (uid !== meta.userId && peer.ws.readyState === 1) peer.ws.send(JSON.stringify(payload))
        }
      })
      ws.on('close', () => {
        if (meta.room && rooms.has(meta.room)) {
          rooms.get(meta.room).delete(meta.userId)
          broadcastPeers(meta.room)
        }
      })
    })
    server.listen(COLLAB_PORT, '127.0.0.1')
  } catch (e) {
    diag.appendLog('collab', 'error', e.message)
  }
}

function broadcastPeers(roomId) {
  const room = rooms.get(roomId)
  if (!room) return
  const list = [...room.entries()].map(([userId, p]) => ({ userId, name: p.name }))
  for (const p of room.values()) {
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ type: 'peers', list }))
  }
}

function pushReviewQueueToWindows(items) {
  reviewQueueSnapshot = items || []
  safeSend(reviewWin, 'review-queue', reviewQueueSnapshot)
}

function ensureReviewWindow() {
  if (reviewWin && !reviewWin.isDestroyed()) {
    if (!reviewWin.isVisible()) reviewWin.show()
    reviewWin.focus()
    safeSend(reviewWin, 'review-queue', reviewQueueSnapshot)
    return reviewWin
  }
  reviewWin = new BrowserWindow({
    width: 720,
    height: 560,
    minWidth: 480,
    minHeight: 360,
    show: true,
    backgroundColor: '#FAF9F5',
    title: 'CCui — Review',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  reviewWin.on('closed', () => { reviewWin = null })
  reviewWin.loadFile(path.join(__dirname, 'review.html'))
  reviewWin.webContents.once('did-finish-load', () => {
    safeSend(reviewWin, 'review-queue', reviewQueueSnapshot)
  })
  return reviewWin
}

function ensureLauncherWindow() {
  if (launcherWin && !launcherWin.isDestroyed()) {
    if (!launcherWin.isVisible()) launcherWin.show()
    launcherWin.focus()
    return launcherWin
  }
  launcherWin = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 640,
    minHeight: 520,
    show: true,
    backgroundColor: '#FAF9F5',
    title: 'CCui — 主页',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  launcherWin.on('closed', () => {
    launcherWin = null
    const winVisible = !!(win && !win.isDestroyed() && win.isVisible())
    diag.appendLog('main', 'info', 'launcher closed', { winVisible })
    // 主页关闭且主窗从未显示 → 退出 app（避免无可见窗口卡死）
    if (!winVisible) {
      if (win && !win.isDestroyed()) win.close()
      else app.quit()
    }
  })
  launcherWin.loadFile(path.join(__dirname, 'launcher.html'))
  diag.appendLog('main', 'info', 'launcher window created')
  return launcherWin
}

/** 进入工作区：显示/聚焦主工作区窗口，转发要打开的内容 */
function enterWorkspace(payload) {
  if (!win || win.isDestroyed()) createWindow({ autoShow: true })
  const deliver = () => {
    if (!win || win.isDestroyed()) return
    win.show()
    win.focus()
    safeSend(win, 'enter-workspace', payload || {})
  }
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', deliver)
  else deliver()
}

function ensureHarnessWindow() {
  if (harnessWin && !harnessWin.isDestroyed()) {
    if (!harnessWin.isVisible()) harnessWin.show()
    harnessWin.focus()
    return harnessWin
  }
  harnessWin = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 760,
    minHeight: 460,
    show: true,
    backgroundColor: '#FAF9F5',
    title: 'CCui — Harness',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  harnessWin.on('closed', () => { harnessWin = null })
  harnessWin.loadFile(path.join(__dirname, 'harness.html'))
  return harnessWin
}

function startDaemon(projectRoot) {
  const cwd = projectRoot || projectsStore?.getCurrentRoot() || ROOT
  const bun = resolveBun()
  if (!bun) {
    diag.appendLog('daemon', 'error', 'bun.exe not found')
    diag.writeStatus({ daemonStatus: 'error' })
    return
  }
  diag.appendLog('daemon', 'info', 'spawning', { bun, script: DAEMON, cwd })
  daemon = spawn(bun, [DAEMON], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CLAUDE_CODE_DEV: '1',
      CCUI_STACK: '1',
      CCUI_MEMORY: '1',
    },
    windowsHide: true,
  })
  safeSend(win, 'daemon', { kind: 'status', state: 'starting' })
  diag.writeStatus({ daemonStatus: 'starting' })
  daemon.on('error', err => {
    diag.appendLog('daemon', 'error', 'spawn failed', err.message)
    diag.writeStatus({ daemonStatus: 'error' })
  })
  daemon.stdout.on('data', chunk => {
    stdoutBuf += chunk.toString('utf8')
    let idx
    while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, idx).trim()
      stdoutBuf = stdoutBuf.slice(idx + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line)
        safeSend(win, 'daemon', msg)
        safeSend(harnessWin, 'daemon', msg)
        safeSend(launcherWin, 'daemon', msg)
      } catch (e) {
        diag.appendLog('daemon', 'warn', 'stdout non-json line', line.slice(0, 500))
      }
    }
  })
  daemon.stderr.on('data', d => {
    const text = d.toString('utf8')
    diag.appendLog('daemon', 'warn', 'stderr', text.trim())
    safeSend(win, 'daemon-log', text)
  })
  daemon.on('exit', code => {
    diag.appendLog('daemon', 'info', 'exit', { code })
    diag.writeStatus({ daemonStatus: 'offline' })
    safeSend(win, 'daemon', { kind: 'exit', code })
    safeSend(win, 'daemon', { kind: 'status', state: 'offline' })
  })
}

function switchProjectDaemon(projectRoot) {
  const cwd = projectRoot || projectsStore?.getCurrentRoot() || ROOT
  sendToDaemon({ cmd: 'setProjectRoot', path: cwd, reqId: `proj_${Date.now()}` })
}

function notifyProjectChanged() {
  if (!projectsStore) return
  const root = projectsStore.getCurrentRoot()
  safeSend(win, 'project-changed', { path: root, name: path.basename(root) })
}

function sendToDaemon(obj) {
  if (daemon && daemon.stdin.writable) daemon.stdin.write(`${JSON.stringify(obj)}\n`)
}

const FONT_FALLBACK = [
  'PingFang SC', 'PingFang TC', 'Microsoft YaHei UI', '微软雅黑', 'Segoe UI',
  'SimSun', 'Arial', 'Times New Roman', 'Consolas', 'Courier New',
]

let fontsCache = null

function listSystemFonts() {
  if (fontsCache) return fontsCache
  if (process.platform === 'win32') {
    try {
      const out = execSync(
        'powershell -NoProfile -Command "Add-Type -AssemblyName System.Drawing; [System.Drawing.FontFamily]::Families | ForEach-Object { $_.Name } | Sort-Object -Unique"',
        { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024, timeout: 12000, windowsHide: true },
      )
      const fonts = [...new Set(out.split(/\r?\n/).map(s => s.trim()).filter(Boolean))]
      if (fonts.length > 20) {
        fontsCache = fonts
        return fontsCache
      }
    } catch {}
  }
  if (process.platform === 'darwin') {
    try {
      const names = new Set(['PingFang SC', 'PingFang TC', 'Helvetica Neue', 'Arial', 'Menlo', 'SF Pro Text'])
      for (const dir of [
        '/System/Library/Fonts',
        '/System/Library/Fonts/Supplemental',
        '/Library/Fonts',
        path.join(process.env.HOME || '', 'Library/Fonts'),
      ]) {
        try {
          for (const f of fs.readdirSync(dir)) {
            const base = f.replace(/\.(ttf|otf|ttc)$/i, '').replace(/[-_]/g, ' ')
            if (base.length > 1) names.add(base)
          }
        } catch {}
      }
      fontsCache = [...names].sort((a, b) => a.localeCompare(b, 'zh'))
      return fontsCache
    } catch {}
  }
  fontsCache = [...FONT_FALLBACK].sort((a, b) => a.localeCompare(b, 'zh'))
  return fontsCache
}

ipcMain.on('cmd', (_evt, obj) => sendToDaemon(obj))
ipcMain.handle('collab-port', () => COLLAB_PORT)

ipcMain.handle('projects:get', () => projectsStore?.getState() || { current: ROOT, recent: [] })
ipcMain.handle('projects:pick', async () => {
  const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() || win, { properties: ['openDirectory'] })
  if (r.canceled || !r.filePaths?.[0]) return { ok: false, canceled: true }
  const sw = projectsStore?.switchTo(r.filePaths[0])
  if (!sw?.ok) return sw || { ok: false, error: 'switch failed' }
  switchProjectDaemon(projectsStore.getCurrentRoot())
  notifyProjectChanged()
  return { ok: true, path: projectsStore.getCurrentRoot(), name: path.basename(projectsStore.getCurrentRoot()), recent: projectsStore.getState().recent }
})
ipcMain.handle('projects:switch', (_evt, projectPath) => {
  const sw = projectsStore?.switchTo(projectPath)
  if (!sw?.ok) return sw || { ok: false, error: 'path not found' }
  switchProjectDaemon(projectsStore.getCurrentRoot())
  notifyProjectChanged()
  return { ok: true, path: projectsStore.getCurrentRoot(), name: path.basename(projectsStore.getCurrentRoot()) }
})
ipcMain.handle('projects:pin', (_evt, { path: projectPath, pinned }) => {
  projectsStore?.pin(projectPath, pinned)
  return projectsStore?.getState() || { ok: true }
})
ipcMain.handle('projects:remove', (_evt, projectPath) => {
  const r = projectsStore?.remove(projectPath)
  return r || { ok: false }
})
ipcMain.handle('projects:open-explorer', (_evt, projectPath) => {
  const p = projectPath || projectsStore?.getCurrentRoot() || ROOT
  shell.openPath(p)
  return { ok: true }
})

ipcMain.on('review-queue', (_evt, items) => pushReviewQueueToWindows(items))
ipcMain.on('review-open', () => ensureReviewWindow())
ipcMain.on('harness-open', () => ensureHarnessWindow())
ipcMain.on('launcher-open', () => ensureLauncherWindow())
ipcMain.on('enter-workspace', (_evt, payload) => enterWorkspace(payload))
ipcMain.on('review-action', (_evt, payload) => {
  safeSend(win, 'review-action', payload)
})

ipcMain.on('diag-log', (_evt, payload) => {
  const { level = 'info', source = 'renderer', message = '', detail } = payload || {}
  diag.appendLog(source, level, message, detail)
  if (source === 'renderer' && message === 'boot ok') diag.writeStatus({ rendererBoot: 'ok' })
  if (source === 'renderer' && message === 'boot failed') diag.writeStatus({ rendererBoot: 'failed' })
  if (source === 'renderer' && message === 'daemon ready') diag.writeStatus({ daemonStatus: 'ready' })
  if (source === 'renderer' && message === 'daemon error') diag.writeStatus({ daemonStatus: 'error' })
})

ipcMain.handle('export-pdf', async (_evt, { html, title }) => {
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${title || 'export'}</title>
<style>body{font-family:system-ui,sans-serif;padding:24px;line-height:1.6;color:#222}pre{white-space:pre-wrap;background:#f5f5f5;padding:8px;border-radius:6px}h1,h2{margin-top:1.2em}</style></head><body>${html}</body></html>`
  await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(doc)}`)
  const pdf = await pdfWin.webContents.printToPDF({ printBackground: true, marginsType: 1 })
  pdfWin.close()
  const { filePath, canceled } = await dialog.showSaveDialog(win, {
    defaultPath: `${(title || 'ccui-export').slice(0, 32)}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (canceled || !filePath) return { ok: false }
  fs.writeFileSync(filePath, pdf)
  return { ok: true, path: filePath }
})

function sendWindowChrome(w) {
  if (!w || !chromeStore) return
  safeSend(w, 'window-chrome', {
    ...chromeStore.get(),
    platform: process.platform,
    isMaximized: w.isMaximized(),
  })
}

ipcMain.handle('window:getChrome', () => {
  if (!win || !chromeStore) return { ...DEFAULT_CHROME_FALLBACK(), platform: process.platform, isMaximized: false }
  return {
    ...chromeStore.get(),
    platform: process.platform,
    isMaximized: win.isMaximized(),
  }
})

function DEFAULT_CHROME_FALLBACK() {
  return { style: 'windows', showProject: true, showSession: true, showTheme: true, showConnection: true }
}

ipcMain.handle('window:setChrome', async (_evt, patch) => {
  if (!chromeStore) return { ok: false }
  const next = chromeStore.set(patch || {})
  sendWindowChrome(win)
  return { ok: true, chrome: next, recreated: false }
})

ipcMain.handle('window:minimize', () => { win?.minimize() })
ipcMain.handle('window:maximize', () => {
  if (!win) return false
  const maxed = win.isMaximized()
  safeSend(win, 'window-chrome-anim', { mode: maxed ? 'restore' : 'maximize' })
  if (maxed) win.unmaximize()
  else win.maximize()
  return win.isMaximized()
})
ipcMain.handle('window:close', () => { win?.close() })
ipcMain.handle('window:isMaximized', () => win?.isMaximized() ?? false)
ipcMain.handle('fonts:list', () => listSystemFonts())
ipcMain.handle('dialog:pickFiles', async () => {
  if (!win) return []
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] })
  return r.canceled ? [] : r.filePaths
})
ipcMain.handle('dialog:pickDir', async () => {
  if (!win) return null
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  return r.canceled || !r.filePaths?.[0] ? null : r.filePaths[0]
})
ipcMain.handle('clipboard:saveImage', () => {
  try {
    const { clipboard } = require('electron')
    const img = clipboard.readImage()
    if (img.isEmpty()) return null
    const dir = path.join(app.getPath('temp'), 'ccui-paste')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `paste-${Date.now()}.png`)
    fs.writeFileSync(file, img.toPNG())
    return file
  } catch {
    return null
  }
})

function createWindow(opts = {}) {
  Menu.setApplicationMenu(null)
  const chrome = chromeStore?.get() || DEFAULT_CHROME_FALLBACK()
  const bounds = opts.bounds
  const winOpts = {
    width: bounds?.width || 1080,
    height: bounds?.height || 720,
    minWidth: 720,
    minHeight: 480,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#FAF9F5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  }
  if (bounds?.x != null) winOpts.x = bounds.x
  if (bounds?.y != null) winOpts.y = bounds.y
  win = new BrowserWindow(winOpts)
  if (opts.maximized) win.maximize()
  win.once('ready-to-show', () => { safeSend(win, 'ready', true); if (win && opts.autoShow !== false) win.show() })
  win.on('closed', () => { win = null })
  win.on('maximize', () => safeSend(win, 'window-maximized', true))
  win.on('unmaximize', () => safeSend(win, 'window-maximized', false))
  win.webContents.on('did-finish-load', () => sendWindowChrome(win))
  diag.bindWindowDiag(win)
  win.loadFile(path.join(__dirname, 'index.html'))
  diag.appendLog('main', 'info', `main window created (chrome=${chrome.style})`)
}

if (gotLock) {
  app.whenReady().then(() => {
    projectsStore = createProjectsStore(ROOT, app.getPath('userData'))
    chromeStore = createChromeStore(app.getPath('userData'))
    startCollabServer()
    // 主工作区窗口隐藏创建：绑定/通道就绪，但等「进入工作区」才显示（PCL 式）
    createWindow({ autoShow: false })
    startDaemon(projectsStore.getCurrentRoot())
    // 主页是第一个可见窗口
    ensureLauncherWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) ensureLauncherWindow()
    })
  })
}

app.on('window-all-closed', () => {
  diag.appendLog('main', 'info', 'window-all-closed → quit')
  if (daemon) daemon.kill()
  if (wss) wss.close()
  if (process.platform !== 'darwin') app.quit()
})
