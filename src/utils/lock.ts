/**
 * Web Locks 包装（R-D14：同一任务同时只有一个标签页在执行）。
 * 不支持 Web Locks 的环境按单标签页处理，直接执行。
 */
export async function withTabLock<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<{ acquired: boolean; result?: T }> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  if (!locks?.request) {
    const result = await fn()
    return { acquired: true, result }
  }
  let outcome: { acquired: boolean; result?: T } = { acquired: false }
  await locks.request(name, { ifAvailable: true }, async (lock) => {
    if (!lock) return
    const result = await fn()
    outcome = { acquired: true, result }
  })
  return outcome
}
