/** Pseudo-static web extensions that don't indicate actual file type */
export const PSEUDO_STATIC_EXTS = new Set(['html', 'htm', 'php', 'asp', 'aspx', 'jsp', 'cgi'])

/** Known video platform domains (yt-dlp can handle these) */
export const VIDEO_PLATFORM_DOMAINS = [
  'v.qq.com', 'bilibili.com', 'bilivideo.com', 'b23.tv',
  'youtube.com', 'youtu.be', 'douyin.com', 'iesdouyin.com',
  'youku.com', 'iqiyi.com', 'vimeo.com', 'twitch.tv',
  'twitter.com', 'x.com', 'instagram.com', 'tiktok.com',
]

/** Check if a URL belongs to a known video platform */
export function isVideoPlatform(url: string): boolean {
  return VIDEO_PLATFORM_DOMAINS.some(s => url.includes(s))
}

/**
 * Extract file extension from a URL's last path segment.
 * Filters out pseudo-static web extensions (html, php, etc.)
 * and returns '' for them (caller can then apply platform-aware defaults).
 */
export function extractExtFromUrl(url: string): string {
  const lastSeg = url.split('?')[0].split('#')[0].split('/').pop() || ''
  const ext = lastSeg.includes('.') ? lastSeg.split('.').pop()?.toLowerCase() || '' : ''
  if (PSEUDO_STATIC_EXTS.has(ext)) return ''
  return ext
}

/** Known file extensions by type */
const VIDEO_EXTS = new Set(['mp4', 'webm', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'm4v', 'ts', 'm3u8'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'wma', 'opus'])
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'])
const DOC_EXTS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'json', 'yaml', 'yml', 'txt', 'md'])

/** Non-ID URL path segments (platform routing noise, not video identifiers) */
const NON_ID_SEGMENTS = new Set(['watch', 'page', 'x', 'video', 'play', 'embed', 'v', 'share', 'live', 'channel', 'c', 'user', '@'])

/**
 * Extract a human-readable video/source ID from a URL.
 * Only returns a meaningful ID for known video platforms.
 * For direct file links or unknown sites, returns '' (caller should use itemId fallback).
 *
 * Examples:
 *   v.qq.com/x/page/l3503vghztq.html → l3503vghztq
 *   bilibili.com/video/BV1xx411c7mD   → BV1xx411c7mD
 *   youtube.com/watch?v=abc123        → abc123
 *   youtu.be/abc123                   → abc123
 *   example.com/file.mp4              → '' (use itemId fallback)
 */
export function extractVideoId(url: string): string {
  // Only extract meaningful IDs from known video platforms
  if (!isVideoPlatform(url)) return ''

  // YouTube: ID is in ?v= query param or youtu.be path
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    if (url.includes('youtu.be')) {
      return url.split('?')[0].split('/').pop() || ''
    }
    try {
      const params = new URLSearchParams(url.split('?')[1] || '')
      return params.get('v') || ''
    } catch {
      return ''
    }
  }

  // General: last path segment, strip pseudo-static + media extensions
  const lastSeg = url.split('?')[0].split('#')[0].split('/').pop() || ''
  let id = lastSeg
  const dotIdx = id.lastIndexOf('.')
  if (dotIdx > 0) {
    const ext = id.slice(dotIdx + 1).toLowerCase()
    if (PSEUDO_STATIC_EXTS.has(ext) || VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext)) {
      id = id.slice(0, dotIdx)
    }
  }

  if (!id || NON_ID_SEGMENTS.has(id)) return ''
  return id
}

/** Classify a file extension into a broad type category */
export function classifyExt(ext: string): 'video' | 'audio' | 'image' | 'document' | 'unknown' {
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (DOC_EXTS.has(ext)) return 'document'
  return 'unknown'
}

/**
 * Determine file type from URL + extension, with platform awareness.
 * Mirrors the logic that was scattered across crawler/downloader.
 */
export function resolveFileType(url: string, ext: string): string {
  // Strip pseudo-static extensions
  if (PSEUDO_STATIC_EXTS.has(ext)) ext = ''

  if (ext) {
    const type = classifyExt(ext)
    if (type !== 'unknown') return type
  }

  // Known video platforms → video even without a recognized extension
  if (isVideoPlatform(url)) return 'video'

  // Heuristic URL patterns
  if (url.includes('video') || url.includes('mp4') || url.includes('m3u8')) return 'video'
  if (url.includes('audio') || url.includes('mp3') || url.includes('.wav')) return 'audio'

  return 'unknown'
}
