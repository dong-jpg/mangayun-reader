import { afterEach } from 'vitest'
import { cleanupActiveCount } from '../src/utils/cleanup'

afterEach(() => {
  if (cleanupActiveCount() !== 0) {
    throw new Error(`清理表泄漏：${cleanupActiveCount()} 个未释放项`)
  }
})
