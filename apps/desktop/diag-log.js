// Agent-readable GUI diagnostics — append to logs/gui-latest.log + logs/gui-status.json
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const LOG_DIR = path.join(ROOT, 'logs')
const LOG_FILE = path.join(LOG_DIR, 'gui-latest.log')
const STATUS_FILE = path.join(LOG_DIR, 'gui-status.json')
const MAX_BYTES = 512 * 1024

/** @type {Record<string, unknown>} */
let status = {
  pid: process.pid,
  startedAt: new Date().toISOString(),
  logFile: LOG_FILE,
  statusFile: STATUS_FILE,
  mainReady: false,
  rendererBoot: 'pending',
  daemonStatus: 'unknown',
  lastError: null,
  lastLine: null,
}

function ensureDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }) } catch {}
}

function trimLogIfNeeded() {
  try {
    const st = fs.statSync(LOG_FILE)
    if (st.size <= MAX_BYTES) return
    const buf = fs.readFileSync(LOG_FILE, 'utf8')
    fs.writeFileSync(LOG_FILE, buf.slice(-Math.floor(MAX_BYTES * 0.75)), 'utf8')
  } catch {}
}

function writeStatus(patch = {}) {
  status = { ...status, ...patch, updatedAt: new Date().toISOString() }
  try {
    ensureDir()
    fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf8')
  } catch {}
}

/**
 * @param {string} source
 * @param {'info'|'warn'|'error'|'debug'} level
 * @param {string} message
 * @param {unknown} [detail]
 */
function appendLog(source, level, message, detail) {
  ensureDir()
  const ts = new Date().toISOString()
  let line = `[${ts}] [${level}] [${source}] ${String(message).replace(/\r?\n/g, ' ')}`
  if (detail != null && detail !== '') {
    try {
      const extra = typeof detail === 'string' ? detail : JSON.stringify(detail)
      if (extra) line += ` | ${extra.slice(0, 2000)}`
    } catch {}
  }
  line += '\n'
  try {
    fs.appendFileSync(LOG_FILE, line, 'utf8')
    trimLogIfNeeded()
  } catch {}
  status.lastLine = line.trim()
  if (level === 'error') status.lastError = { at: ts, source, message: String(message) }
  writeStatus()
  return line.trim()
}

function initMainDiag() {
  ensureDir()
  try {
    fs.writeFileSync(LOG_FILE, `=== CCui GUI session ${status.startedAt} pid=${status.pid} ===\n`, 'utf8')
  } catch {}
  writeStatus({ mainReady: true })

  process.on('uncaughtException', err => {
    appendLog('main', 'error', err?.message || String(err), err?.stack)
  })
  process.on('unhandledRejection', reason => {
    appendLog('main', 'error', 'unhandledRejection', reason instanceof Error ? reason.stack : reason)
  })

  const wrap = (fn, level, source) => (...args) => {
    const msg = args.map(a => (typeof a === 'string' ? a : (a?.message || JSON.stringify(a)))).join(' ')
    appendLog(source, level, msg)
    fn.apply(console, args)
  }
  console.log = wrap(console.log, 'info', 'main-console')
  console.warn = wrap(console.warn, 'warn', 'main-console')
  console.error = wrap(console.error, 'error', 'main-console')

  appendLog('main', 'info', 'diag log initialized', { logFile: LOG_FILE })
}

function bindWindowDiag(win) {
  if (!win?.webContents) return
  const wc = win.webContents
  wc.on('did-fail-load', (_e, code, desc, url) => {
    appendLog('renderer', 'error', `did-fail-load ${code} ${desc}`, { url })
  })
  wc.on('render-process-gone', (_e, details) => {
    appendLog('renderer', 'error', 'render-process-gone', details)
    writeStatus({ rendererBoot: 'crashed' })
  })
  wc.on('console-message', (event) => {
    const { level, message, line, sourceId } = event
    const lv = level >= 3 ? 'error' : level >= 2 ? 'warn' : 'info'
    appendLog('renderer-console', lv, message, { line, sourceId })
  })
  wc.on('did-finish-load', () => {
    appendLog('renderer', 'info', 'did-finish-load')
  })
}

module.exports = {
  LOG_DIR,
  LOG_FILE,
  STATUS_FILE,
  appendLog,
  initMainDiag,
  bindWindowDiag,
  writeStatus,
  getStatus: () => ({ ...status }),
}
