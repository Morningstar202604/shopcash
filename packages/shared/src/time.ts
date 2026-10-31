export const DEFAULT_TIMEZONE_OFFSET_MIN = 480

export interface TimeFormatOptions {
  offsetMinutes?: number
  withSeconds?: boolean
  dateOnly?: boolean
}

function shift(iso: string, offsetMinutes: number): Date {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) throw new RangeError(`时间非法：${iso}`)
  return new Date(t.getTime() + offsetMinutes * 60000)
}

const pad = (n: number): string => String(n).padStart(2, '0')

export function formatDateTime(iso: string, opt: TimeFormatOptions = {}): string {
  if (!iso) return '—'
  const d = shift(iso, opt.offsetMinutes ?? DEFAULT_TIMEZONE_OFFSET_MIN)
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  if (opt.dateOnly) return date
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  return opt.withSeconds ? `${date} ${time}:${pad(d.getUTCSeconds())}` : `${date} ${time}`
}

export function formatTime(iso: string, opt: TimeFormatOptions = {}): string {
  if (!iso) return '—'
  const d = shift(iso, opt.offsetMinutes ?? DEFAULT_TIMEZONE_OFFSET_MIN)
  return opt.withSeconds
    ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
    : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

export function formatMonthDayMinute(iso: string, opt: TimeFormatOptions = {}): string {
  if (!iso) return '—'
  const d = shift(iso, opt.offsetMinutes ?? DEFAULT_TIMEZONE_OFFSET_MIN)
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
