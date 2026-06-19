// IndexedDB 持久化层 — 零依赖，Promise 化。stores: presets / conversations / templates / settings
const DB_NAME = 'ccui'
const DB_VERSION = 1
const STORES = ['presets', 'conversations', 'templates', 'settings']

let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, { keyPath: 'id' })
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'))
  })
  return dbPromise
}

function tx(store, mode) {
  return openDB().then(db => {
    const t = db.transaction(store, mode)
    return [t, t.objectStore(store)]
  })
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export const db = {
  async getAll(store) {
    const [, os] = await tx(store, 'readonly')
    const all = await reqToPromise(os.getAll())
    return all || []
  },
  async get(store, id) {
    const [, os] = await tx(store, 'readonly')
    return reqToPromise(os.get(id))
  },
  async put(store, value) {
    const [t, os] = await tx(store, 'readwrite')
    os.put(value)
    await new Promise((res, rej) => {
      t.oncomplete = res
      t.onerror = () => rej(t.error)
      t.onabort = () => rej(t.error)
    })
    return value
  },
  async delete(store, id) {
    const [t, os] = await tx(store, 'readwrite')
    os.delete(id)
    await new Promise((res, rej) => {
      t.oncomplete = res
      t.onerror = () => rej(t.error)
    })
  },
  async clear(store) {
    const [t, os] = await tx(store, 'readwrite')
    os.clear()
    await new Promise(res => { t.oncomplete = res })
  },
  // 全量导出（备份/迁移）
  async exportAll() {
    const out = { version: DB_VERSION, exportedAt: Date.now(), data: {} }
    for (const s of STORES) out.data[s] = await this.getAll(s)
    return out
  },
  // 导入（合并，按 id 覆盖）
  async importAll(payload) {
    if (!payload || !payload.data) throw new Error('导入文件格式不正确')
    for (const s of STORES) {
      const rows = payload.data[s]
      if (!Array.isArray(rows)) continue
      for (const row of rows) {
        if (row && row.id != null) await this.put(s, row)
      }
    }
  },
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
