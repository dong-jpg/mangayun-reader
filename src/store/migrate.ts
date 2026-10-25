/**
 * 存储迁移（R-P1）：键名带 `myr:v1:` 版本前缀。
 * 未来升级数据结构时在此追加迁移步骤，保证旧数据可读。
 */
import type { KV } from './kv'
import { KEY_SETTINGS, mergeSettings } from './settings'

export interface MigrationResult {
  migrated: string[]
}

/** 目前只有 v1：补齐缺失字段并规范化非法值。 */
export function migrateStorage(kv: KV): MigrationResult {
  const result: MigrationResult = { migrated: [] }
  const raw = kv.get<unknown>(KEY_SETTINGS)
  if (raw !== undefined) {
    const normalized = mergeSettings(raw)
    kv.set(KEY_SETTINGS, normalized)
    if (JSON.stringify(normalized) !== JSON.stringify(raw)) result.migrated.push(KEY_SETTINGS)
  }
  return result
}

/** 导出全部脚本数据（R-P5）。 */
export function exportData(kv: KV): string {
  const data: Record<string, unknown> = {}
  for (const key of kv.list()) {
    if (key.startsWith('myr:v1:')) data[key] = kv.get<unknown>(key)
  }
  return JSON.stringify({ tool: 'mangayun-reader', schema: 1, exportedAt: new Date().toISOString(), data }, null, 2)
}

/** 导入（R-P5）：整体替换 myr:v1 命名空间。 */
export function importData(kv: KV, json: string): { ok: boolean; error?: string } {
  try {
    const parsed = JSON.parse(json) as { tool?: string; data?: Record<string, unknown> }
    if (parsed?.tool !== 'mangayun-reader' || !parsed.data || typeof parsed.data !== 'object') {
      return { ok: false, error: '不是本脚本的导出文件' }
    }
    for (const key of kv.list()) {
      if (key.startsWith('myr:v1:')) kv.delete(key)
    }
    for (const [key, value] of Object.entries(parsed.data)) {
      if (key.startsWith('myr:v1:')) kv.set(key, value)
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '解析失败' }
  }
}
