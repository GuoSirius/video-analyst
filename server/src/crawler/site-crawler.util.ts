import * as cheerio from 'cheerio'

/**
 * 整站爬取的范围配置。
 * 默认「只爬同域名」，避免爬到外站（用户明确要求：外站的就不用爬了）。
 */
export interface ScopeConfig {
  /** 仅允许同主域（含子域）。防爬到外站。默认 true */
  sameDomain: boolean
  /** 仅允许的路径前缀白名单，如 ['/docs', '/blog']。为空=不限制 */
  allowPaths: string[]
  /** 排除的路径前缀黑名单，如 ['/login', '/cart', '/admin'] */
  denyPaths: string[]
  /** URL 正则白名单，任一匹配才保留 */
  includeRegex: string[]
  /** URL 正则黑名单，任一匹配即排除（优先级高于白名单） */
  excludeRegex: string[]
}

export const DEFAULT_SCOPE: ScopeConfig = {
  sameDomain: true,
  allowPaths: [],
  denyPaths: [],
  includeRegex: [],
  excludeRegex: [],
}

/** 安全测试正则：非法正则视为不匹配，不抛错 */
function safeTest(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value)
  } catch {
    return false
  }
}

/**
 * 将页面中发现的 href 归一化为绝对 URL。
 * 过滤掉 mailto:/tel:/javascript:/data:/纯锚点(#)/非 http(s) 链接。
 * 去除 fragment（#...）以减少重复入队。
 */
export function normalizeLink(href: string | undefined, baseUrl: string): string | null {
  if (!href) return null
  const h = href.trim()
  if (!h) return null
  if (/^(mailto:|tel:|javascript:|data:|#|irc:|about:)/i.test(h)) return null
  try {
    const abs = new URL(h, baseUrl).href
    if (!abs.startsWith('http://') && !abs.startsWith('https://')) return null
    // 去 fragment：同一页面的不同锚点视为同一 URL
    return abs.split('#')[0]
  } catch {
    return null
  }
}

/**
 * 判断一个 URL 是否在爬取范围内。
 * @param url 已归一化的绝对 URL
 * @param scope 范围配置
 * @param entryHost 入口页 host（用于 sameDomain 判定）
 */
export function inScope(url: string, scope: ScopeConfig, entryHost: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false

  const host = u.host.toLowerCase()
  const base = entryHost.toLowerCase()

  // 同域（含子域）拦截外站
  if (scope.sameDomain) {
    if (host !== base && !host.endsWith('.' + base)) return false
  }

  // 路径前缀白名单
  if (scope.allowPaths && scope.allowPaths.length > 0) {
    if (!scope.allowPaths.some(p => u.pathname.startsWith(p))) return false
  }

  // 路径前缀黑名单（排除登录/购物车/后台等）
  if (scope.denyPaths && scope.denyPaths.length > 0) {
    if (scope.denyPaths.some(p => u.pathname.startsWith(p))) return false
  }

  // 正则白名单
  if (scope.includeRegex && scope.includeRegex.length > 0) {
    if (!scope.includeRegex.some(rx => safeTest(rx, url))) return false
  }

  // 正则黑名单（优先级最高）
  if (scope.excludeRegex && scope.excludeRegex.length > 0) {
    if (scope.excludeRegex.some(rx => safeTest(rx, url))) return false
  }

  return true
}

/**
 * 从 HTML 中提取全部待发现链接（已归一化为绝对 URL 并去重）。
 * @param html 页面 HTML
 * @param linkSelector 链接发现选择器（默认 a[href]）
 * @param baseUrl 当前页 URL，用于把相对链接转绝对
 */
export function extractLinks(html: string, linkSelector: string, baseUrl: string): string[] {
  const $ = cheerio.load(html)
  const out = new Set<string>()
  $(linkSelector).each((_, el) => {
    const href = $(el).attr('href')
    const abs = normalizeLink(href, baseUrl)
    if (abs) out.add(abs)
  })
  return Array.from(out)
}
