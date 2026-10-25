/**
 * ZIP 保存（R-D12，基线 §8.3）：用户点击“保存 ZIP”触发；
 * 优先 GM_download（支持 blob URL 时），否则对象 URL + a[download]。
 * 明确区分“已交给系统下载”和“确认已保存”。
 */
export type SaveStatus = 'handed-off' | 'saved' | 'failed'

export interface SaveResult {
  status: SaveStatus
  detail?: string
}

interface GmDownload {
  (options: {
    url: string
    name: string
    saveAs?: boolean
    onload?: () => void
    onerror?: (err: { error?: string; details?: string }) => void
    ontimeout?: () => void
  }): unknown
  /** 新版支持以 Blob 形式保存时的基础判断（不可用时走对象 URL）。 */
  (url: string, name: string): unknown
}

function getGmDownload(): GmDownload | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gm = (globalThis as any).GM_download as GmDownload | undefined
  return typeof gm === 'function' ? gm : null
}

/** 对象 URL + a[download] 手动保存路径。 */
function saveViaAnchor(url: string, name: string): SaveResult {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 无法验证系统落盘：只声明“已交给系统下载”
  return { status: 'handed-off', detail: '已交给系统下载，请在通知栏/下载记录确认' }
}

export async function saveZip(source: File | Blob, fileName: string): Promise<SaveResult> {
  const url = URL.createObjectURL(source)
  try {
    const gm = getGmDownload()
    if (gm) {
      return await new Promise<SaveResult>((resolve) => {
        let settled = false
        const finish = (result: SaveResult) => {
          if (settled) return
          settled = true
          resolve(result)
        }
        try {
          gm({
            url,
            name: fileName,
            saveAs: false,
            onload: () => finish({ status: 'saved', detail: '已保存' }),
            onerror: (err) => {
              const reason = err?.error ?? ''
              if (reason === 'not_whitelisted' || reason === 'not_enabled' || reason === 'unknown_something') {
                // 权限/能力不足：回退对象 URL 路径
                finish(saveViaAnchor(url, fileName))
              } else {
                finish({ status: 'failed', detail: `GM_download 失败：${reason || '未知错误'}` })
              }
            },
            ontimeout: () => finish({ status: 'failed', detail: 'GM_download 超时' }),
          })
          // GM_download 未提供进度回调时 5s 内无 onload/onerror，按已提交处理
          setTimeout(() => finish({ status: 'handed-off', detail: '已交给系统下载' }), 5000)
        } catch {
          finish(saveViaAnchor(url, fileName))
        }
      })
    }
    return saveViaAnchor(url, fileName)
  } finally {
    // 稍后释放对象 URL；GM_download 与 a[download] 已拿到引用
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
