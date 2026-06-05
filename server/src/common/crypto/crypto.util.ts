import * as crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const ENCODING = 'hex' as const

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || 'video-analyst-default-key-2026'
  return crypto.scryptSync(secret, 'video-analyst-salt', 32)
}

export function encrypt(text: string): string {
  if (!text) return ''
  const key = getKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(text, 'utf8', ENCODING)
  encrypted += cipher.final(ENCODING)
  const tag = cipher.getAuthTag()
  return iv.toString(ENCODING) + ':' + tag.toString(ENCODING) + ':' + encrypted
}

export function decrypt(data: string): string {
  if (!data) return ''
  // 如果是老数据（未加密），直接返回
  if (!data.includes(':') || data.split(':').length !== 3) {
    return data
  }
  const key = getKey()
  const parts = data.split(':')
  const iv = Buffer.from(parts[0], ENCODING)
  const tag = Buffer.from(parts[1], ENCODING)
  const encrypted = parts[2]
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  let decrypted = decipher.update(encrypted, ENCODING, 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}
