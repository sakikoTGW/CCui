// Main-process window chrome preferences (read before BrowserWindow creation)
const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_CHROME = {
  style: 'windows',
  showProject: true,
  showSession: true,
  showTheme: true,
  showConnection: true,
}

/** @param {string} userDataDir */
function createChromeStore(userDataDir) {
  const storePath = path.join(userDataDir, 'ccui-chrome.json')
  let state = load()

  function load() {
    try {
      const raw = fs.readFileSync(storePath, 'utf8')
      const parsed = JSON.parse(raw)
      return normalize(parsed)
    } catch {
      return { ...DEFAULT_CHROME }
    }
  }

  function normalize(raw) {
    return {
      style: 'windows',
      showProject: raw?.showProject !== false,
      showSession: raw?.showSession !== false,
      showTheme: raw?.showTheme !== false,
      showConnection: raw?.showConnection !== false,
    }
  }

  function save() {
    try {
      fs.mkdirSync(userDataDir, { recursive: true })
      fs.writeFileSync(storePath, JSON.stringify(state, null, 2), 'utf8')
    } catch { /* ignore */ }
  }

  return {
    get: () => ({ ...state }),
    set(patch) {
      state = normalize({ ...state, ...patch })
      save()
      return { ...state }
    },
    reset() {
      state = { ...DEFAULT_CHROME }
      save()
      return { ...state }
    },
  }
}

module.exports = { createChromeStore, DEFAULT_CHROME }
