// 把受控的 daemon 通道暴露给 renderer（contextIsolation 安全桥）
const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('ccui', {
  send: (text, opts = {}) =>
    ipcRenderer.send('cmd', {
      cmd: 'send',
      text,
      taskType: opts.taskType,
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      sessionId: opts.sessionId,
    }),
  respondPermission: (id, allow, updatedInput) =>
    ipcRenderer.send('cmd', { cmd: 'respondPermission', id, allow, updatedInput }),
  interrupt: (sessionId) => ipcRenderer.send('cmd', { cmd: 'interrupt', sessionId }),
  reset: (sessionId) => ipcRenderer.send('cmd', { cmd: 'reset', sessionId }),
  hydrateSession: (sessionId, payload) =>
    ipcRenderer.send('cmd', { cmd: 'hydrate', sessionId, ...payload }),
  setEnv: patch => ipcRenderer.send('cmd', { cmd: 'setEnv', patch }),
  request: payload => ipcRenderer.send('cmd', payload),
  setRouter: patch => ipcRenderer.send('cmd', { cmd: 'setRouter', patch }),
  collabPort: () => ipcRenderer.invoke('collab-port'),
  exportPdf: (html, title) => ipcRenderer.invoke('export-pdf', { html, title }),
  pushReviewQueue: items => ipcRenderer.send('review-queue', items),
  openReviewWindow: () => ipcRenderer.send('review-open'),
  reviewAction: payload => ipcRenderer.send('review-action', payload),
  onReviewQueue: cb => {
    const h = (_e, items) => cb(items)
    ipcRenderer.on('review-queue', h)
    return () => ipcRenderer.removeListener('review-queue', h)
  },
  onReviewAction: cb => {
    const h = (_e, payload) => cb(payload)
    ipcRenderer.on('review-action', h)
    return () => ipcRenderer.removeListener('review-action', h)
  },
  getPathForFile: file => {
    try { return webUtils.getPathForFile(file) } catch { return file?.path || '' }
  },
  onDaemon: cb => {
    const h = (_e, msg) => cb(msg)
    ipcRenderer.on('daemon', h)
    return () => ipcRenderer.removeListener('daemon', h)
  },
  onLog: cb => {
    const h = (_e, text) => cb(text)
    ipcRenderer.on('daemon-log', h)
    return () => ipcRenderer.removeListener('daemon-log', h)
  },
  reportDiag: (level, source, message, detail) =>
    ipcRenderer.send('diag-log', { level, source, message, detail }),
  getProjects: () => ipcRenderer.invoke('projects:get'),
  pickProject: () => ipcRenderer.invoke('projects:pick'),
  switchProject: projectPath => ipcRenderer.invoke('projects:switch', projectPath),
  pinProject: (projectPath, pinned) => ipcRenderer.invoke('projects:pin', { path: projectPath, pinned }),
  removeProject: projectPath => ipcRenderer.invoke('projects:remove', projectPath),
  openInExplorer: projectPath => ipcRenderer.invoke('projects:open-explorer', projectPath),
  onProjectChanged: cb => {
    const h = (_e, payload) => cb(payload)
    ipcRenderer.on('project-changed', h)
    return () => ipcRenderer.removeListener('project-changed', h)
  },
  getWindowChrome: () => ipcRenderer.invoke('window:getChrome'),
  setWindowChrome: patch => ipcRenderer.invoke('window:setChrome', patch),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onWindowChrome: cb => {
    const h = (_e, payload) => cb(payload)
    ipcRenderer.on('window-chrome', h)
    return () => ipcRenderer.removeListener('window-chrome', h)
  },
  onWindowMaximized: cb => {
    const h = (_e, v) => cb(v)
    ipcRenderer.on('window-maximized', h)
    return () => ipcRenderer.removeListener('window-maximized', h)
  },
  listFonts: () => ipcRenderer.invoke('fonts:list'),
})
