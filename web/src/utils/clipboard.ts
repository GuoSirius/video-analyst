import { ElMessage } from 'element-plus'

/**
 * Clipboard write with fallback for non-HTTPS contexts.
 * `navigator.clipboard.writeText` requires a secure context (HTTPS or localhost);
 * falls back to `document.execCommand('copy')` when unavailable.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Secure context path
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to fallback
    }
  }

  // Fallback for non-secure contexts
  if (document.execCommand) {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    try {
      const ok = document.execCommand('copy')
      return ok
    } catch {
      return false
    } finally {
      document.body.removeChild(ta)
    }
  }

  return false
}

/** Convenience wrapper: copies and shows ElMessage feedback. */
export async function copyWithFeedback(text: string, successMsg = '已复制到剪贴板') {
  const ok = await copyToClipboard(text)
  if (ok) {
    ElMessage.success(successMsg)
  } else {
    ElMessage.error('复制失败，请手动复制')
  }
}
