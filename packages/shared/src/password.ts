export const WEAK_PASSWORDS = [
  'changeadmin2026',
  'admin@2026',
  'admin2026',
  'password2026',
  'shopcash2026',
  'password123',
  '1234567890',
  'qwertyuiop',
  'abc1234567',
  'admin123456',
]

export const PASSWORD_MIN_LENGTH = 10

export interface PasswordCheck {
  ok: boolean
  failed: string[]
}

export function isWeakPassword(password: string): boolean {
  const text = password.trim().toLowerCase()
  if (!text) return true
  if (WEAK_PASSWORDS.includes(text)) return true
  return WEAK_PASSWORDS.some((w) => text.includes(w))
}

export function checkPassword(password: string, username: string): PasswordCheck {
  const failed: string[] = []
  if (password.length < PASSWORD_MIN_LENGTH) failed.push(`至少 ${PASSWORD_MIN_LENGTH} 位`)
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password)) failed.push('含大写与小写')
  if (!/\d/.test(password)) failed.push('含数字')
  if (!password || password.toLowerCase() === (username || '').trim().toLowerCase()) failed.push('不等于用户名')
  if (isWeakPassword(password)) failed.push('不是常见弱口令')
  return { ok: failed.length === 0, failed }
}
