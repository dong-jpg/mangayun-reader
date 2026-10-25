/**
 * 键值存储抽象（R-P1）：优先 Tampermonkey 存储（GM_*），
 * 不可用时回退到带 `myr:` 前缀的 localStorage（仅 harness/测试环境）。
 * 不读写原站的任何存储键（N-3）。
 */
export interface KV {
  get<T>(key: string): T | undefined
  set(key: string, value: unknown): void
  delete(key: string): void
  list(): string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GmApi = Record<string, any>

function gmApi(): GmApi | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any
  if (typeof g.GM_getValue === 'function' && typeof g.GM_setValue === 'function') {
    return g
  }
  return null
}

const LS_PREFIX = 'myr:kv:'

export function createKV(): KV {
  const gm = gmApi()
  if (gm) {
    return {
      get<T>(key: string): T | undefined {
        const v = gm.GM_getValue(key, undefined)
        return (v as T) ?? undefined
      },
      set(key: string, value: unknown): void {
        gm.GM_setValue(key, value)
      },
      delete(key: string): void {
        if (typeof gm.GM_deleteValue === 'function') gm.GM_deleteValue(key)
      },
      list(): string[] {
        if (typeof gm.GM_listValues === 'function') return gm.GM_listValues() as string[]
        return []
      },
    }
  }
  // localStorage 回退（harness / 测试）
  const storage = (): Storage | null => {
    try {
      return globalThis.localStorage ?? null
    } catch {
      return null
    }
  }
  return {
    get<T>(key: string): T | undefined {
      const raw = storage()?.getItem(LS_PREFIX + key)
      if (raw == null) return undefined
      try {
        return JSON.parse(raw) as T
      } catch {
        return undefined
      }
    },
    set(key: string, value: unknown): void {
      try {
        storage()?.setItem(LS_PREFIX + key, JSON.stringify(value))
      } catch {
        /* 存储不可用或已满：静默失败 */
      }
    },
    delete(key: string): void {
      try {
        storage()?.removeItem(LS_PREFIX + key)
      } catch {
        /* 忽略 */
      }
    },
    list(): string[] {
      const s = storage()
      if (!s) return []
      const out: string[] = []
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i)
        if (k?.startsWith(LS_PREFIX)) out.push(k.slice(LS_PREFIX.length))
      }
      return out
    },
  }
}
