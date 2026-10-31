import { describe, expect, it } from '@jest/globals'
import { formatDateTime, formatMonthDayMinute, formatTime } from '../src/time'

const ISO = '2026-10-30T18:39:48.245Z'

describe('UTC 存储 → 本地展示', () => {
  it('默认按 Asia/Shanghai(+480) 展示，日期与时间同时进位', () => {
    expect(formatDateTime(ISO)).toBe('2026-10-31 02:39')
    expect(formatTime(ISO, { withSeconds: true })).toBe('02:39:48')
    expect(formatMonthDayMinute(ISO)).toBe('10-31 02:39')
  })

  it('零偏移时回落到 UTC 原值', () => {
    expect(formatDateTime(ISO, { offsetMinutes: 0 })).toBe('2026-10-30 18:39')
  })

  it('跨月与跨年边界正确', () => {
    expect(formatDateTime('2026-12-31T16:00:00.000Z')).toBe('2027-01-01 00:00')
    expect(formatDateTime('2026-10-31T15:59:00.000Z')).toBe('2026-10-31 23:59')
  })

  it('空串返回占位符，非法时间抛错', () => {
    expect(formatDateTime('')).toBe('—')
    expect(formatTime('')).toBe('—')
    expect(formatMonthDayMinute('')).toBe('—')
    expect(() => formatDateTime('not-a-date')).toThrow(RangeError)
  })

  it('dateOnly 只给日期，formatTime 默认不带秒', () => {
    expect(formatDateTime(ISO, { dateOnly: true })).toBe('2026-10-31')
    expect(formatTime(ISO)).toBe('02:39')
  })
})
