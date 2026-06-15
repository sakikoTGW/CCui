// Main-process project registry (recent / pinned / current)
const fs = require('node:fs')
const path = require('node:path')

/** @param {string} defaultRoot */
function createProjectsStore(defaultRoot, userDataDir) {
  const storePath = path.join(userDataDir, 'ccui-projects.json')
  let state = load()
  let currentRoot = state.current && fs.existsSync(state.current) ? state.current : defaultRoot

  function load() {
    try {
      const raw = fs.readFileSync(storePath, 'utf8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed.recent)) parsed.recent = []
      return parsed
    } catch {
      return {
        current: defaultRoot,
        recent: [{ path: defaultRoot, name: path.basename(defaultRoot), pinned: true, lastOpened: Date.now() }],
      }
    }
  }

  function save() {
    try {
      fs.mkdirSync(userDataDir, { recursive: true })
      fs.writeFileSync(storePath, JSON.stringify(state, null, 2), 'utf8')
    } catch { /* ignore */ }
  }

  function normalizeEntry(projectPath) {
    const p = path.resolve(projectPath)
    const name = path.basename(p) || p
    return { path: p, name, pinned: false, lastOpened: Date.now() }
  }

  function touchRecent(projectPath) {
    const p = path.resolve(projectPath)
    const name = path.basename(p) || p
    const existing = state.recent.find(r => path.resolve(r.path) === p)
    if (existing) {
      existing.lastOpened = Date.now()
      existing.name = name
    } else {
      state.recent.unshift({ path: p, name, pinned: false, lastOpened: Date.now() })
    }
    state.recent.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
      return (b.lastOpened || 0) - (a.lastOpened || 0)
    })
    state.recent = state.recent.slice(0, 24)
    state.current = p
    currentRoot = p
    save()
  }

  function ensureDefault() {
    if (!state.recent.some(r => path.resolve(r.path) === path.resolve(defaultRoot))) {
      state.recent.unshift({
        path: defaultRoot,
        name: path.basename(defaultRoot),
        pinned: true,
        lastOpened: Date.now(),
      })
    }
    if (!state.current || !fs.existsSync(state.current)) {
      state.current = defaultRoot
      currentRoot = defaultRoot
    }
    save()
  }

  ensureDefault()

  return {
    getCurrentRoot: () => currentRoot,
    getState: () => ({ current: currentRoot, recent: [...state.recent] }),
    switchTo(projectPath) {
      if (!fs.existsSync(projectPath)) return { ok: false, error: 'path not found' }
      touchRecent(projectPath)
      return { ok: true, path: currentRoot, name: path.basename(currentRoot) }
    },
    pin(projectPath, pinned) {
      const p = path.resolve(projectPath)
      const item = state.recent.find(r => path.resolve(r.path) === p)
      if (item) item.pinned = !!pinned
      save()
      return { ok: true }
    },
    remove(projectPath) {
      const p = path.resolve(projectPath)
      state.recent = state.recent.filter(r => path.resolve(r.path) !== p)
      if (path.resolve(state.current) === p) {
        state.current = state.recent[0]?.path || defaultRoot
        currentRoot = state.current
      }
      save()
      return { ok: true, current: currentRoot }
    },
    normalizeEntry,
  }
}

module.exports = { createProjectsStore }
