/**
 * Typed IndexedDB repository. Opens the SAME database as the vanilla app/db.js
 * (name "ccui", v1, keyPath "id"), so React islands and the remaining vanilla
 * views share one data store during the migration.
 */

const DB_NAME = 'ccui'
const DB_VERSION = 1
export const STORES = ['presets', 'conversations', 'templates', 'settings'] as const
export type StoreName = (typeof STORES)[number]

export interface Identified {
  id: string
  [k: string]: unknown
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
  return dbPromise
}

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function txComplete(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

export const idb = {
  async getAll<T extends Identified = Identified>(store: StoreName): Promise<T[]> {
    const db = await openDB()
    const os = db.transaction(store, 'readonly').objectStore(store)
    return (await reqToPromise(os.getAll())) as T[]
  },
  async get<T extends Identified = Identified>(store: StoreName, id: string): Promise<T | undefined> {
    const db = await openDB()
    const os = db.transaction(store, 'readonly').objectStore(store)
    return (await reqToPromise(os.get(id))) as T | undefined
  },
  async put<T extends Identified>(store: StoreName, value: T): Promise<T> {
    const db = await openDB()
    const t = db.transaction(store, 'readwrite')
    t.objectStore(store).put(value)
    await txComplete(t)
    return value
  },
  async delete(store: StoreName, id: string): Promise<void> {
    const db = await openDB()
    const t = db.transaction(store, 'readwrite')
    t.objectStore(store).delete(id)
    await txComplete(t)
  },
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

// ---------- Typed per-entity repositories (P8) ----------
// Concrete shapes for each object store, so islands get type-checked reads/writes
// instead of the loose `Identified` generic. All four share the one "ccui" DB.

export interface Preset extends Identified {
  name: string
  systemPrompt?: string
  model?: string
  tier?: string
}

export interface Conversation extends Identified {
  title?: string
  createdAt?: number
  updatedAt?: number
  messages?: unknown[]
}

export interface Template extends Identified {
  name: string
  body?: string
  category?: string
}

export interface SettingRecord extends Identified {
  value?: unknown
  [k: string]: unknown
}

export interface Repo<T extends Identified> {
  getAll(): Promise<T[]>
  get(id: string): Promise<T | undefined>
  put(value: T): Promise<T>
  delete(id: string): Promise<void>
}

function makeRepo<T extends Identified>(store: StoreName): Repo<T> {
  return {
    getAll: () => idb.getAll<T>(store),
    get: (id: string) => idb.get<T>(store, id),
    put: (value: T) => idb.put<T>(store, value),
    delete: (id: string) => idb.delete(store, id),
  }
}

export const presetsRepo: Repo<Preset> = makeRepo<Preset>('presets')
export const conversationsRepo: Repo<Conversation> = makeRepo<Conversation>('conversations')
export const templatesRepo: Repo<Template> = makeRepo<Template>('templates')
export const settingsRepo: Repo<SettingRecord> = makeRepo<SettingRecord>('settings')
