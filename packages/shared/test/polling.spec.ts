import { describe, expect, it } from '@jest/globals'
import { queryAtMs, DEFAULT_QUERY_BACKOFF_MS } from '../src/polling'

describe('主动查单退避（3s/10s/30s/2min/5min，之后每 5min）', () => {
  it('前五次是累计时刻 3/13/43/163/463 秒，不是把间隔重复累加', () => {
    const base = 0
    expect(queryAtMs(base, 1)).toBe(3000)
    expect(queryAtMs(base, 2)).toBe(13000)
    expect(queryAtMs(base, 3)).toBe(43000)
    expect(queryAtMs(base, 4)).toBe(163000)
    expect(queryAtMs(base, 5)).toBe(463000)
  })

  it('进入尾段后每 5 分钟一次：12.7min、17.7min', () => {
    const base = 0
    expect(queryAtMs(base, 6)).toBe(463000 + 300000)
    expect(queryAtMs(base, 7)).toBe(463000 + 600000)
  })

  it('间隔单调递增且不重复（防止把退避写成累积和）', () => {
    const times = Array.from({ length: 8 }, (_, i) => queryAtMs(0, i + 1))
    for (let i = 1; i < times.length; i += 1) expect(times[i]).toBeGreaterThan(times[i - 1])
    const gaps = times.map((t, i) => t - (i === 0 ? 0 : times[i - 1]))
    expect(gaps).toEqual([3000, 10000, 30000, 120000, 300000, 300000, 300000, 300000])
  })

  it('非法入参抛错而不是静默返回', () => {
    expect(() => queryAtMs(0, 0)).toThrow(RangeError)
    expect(() => queryAtMs(0, 1.5)).toThrow(RangeError)
    expect(() => queryAtMs(0, 1, [])).toThrow(RangeError)
    expect(DEFAULT_QUERY_BACKOFF_MS).toHaveLength(5)
  })
})
