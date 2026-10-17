import { describe, expect, it } from '@jest/globals'
import { AmountError, yuanToFen, fenToYuan, DEFAULT_MAX_AMOUNT_FEN } from '../src/money'

describe('yuanToFen：金额输入 fail-closed 校验', () => {
  it('正常两位小数转分', () => {
    expect(yuanToFen('12.80')).toBe(1280)
  })

  it('整数元补零转分', () => {
    expect(yuanToFen('12')).toBe(1200)
    expect(yuanToFen('7')).toBe(700)
  })

  it('最小可收金额 0.01 元 = 1 分', () => {
    expect(yuanToFen('0.01')).toBe(1)
  })

  it('0 元被拒绝（源项目此处只校验 >0，本项目显式拒绝）', () => {
    expect(() => yuanToFen('0.00')).toThrow(AmountError)
    expect(() => yuanToFen('0')).toThrow(AmountError)
  })

  it('负数被拒绝', () => {
    expect(() => yuanToFen('-1')).toThrow(AmountError)
    expect(() => yuanToFen('-0.01')).toThrow(AmountError)
  })

  it('超过两位小数直接拒绝，绝不四舍五入（13.2 用例 6）', () => {
    expect(() => yuanToFen('12.805')).toThrow(AmountError)
    try {
      yuanToFen('0.005')
    } catch (e) {
      expect((e as AmountError).code).toBe('AMOUNT_DECIMAL_INVALID')
    }
  })

  it('科学计数法与非法字符被拒绝', () => {
    expect(() => yuanToFen('1e9')).toThrow(AmountError)
    expect(() => yuanToFen('1,280.00')).toThrow(AmountError)
    expect(() => yuanToFen('¥12.80')).toThrow(AmountError)
    expect(() => yuanToFen('12.8.0')).toThrow(AmountError)
    expect(() => yuanToFen('')).toThrow(AmountError)
    expect(() => yuanToFen('   ')).toThrow(AmountError)
  })

  it('.80 这种缺整数位写法被拒绝（口径唯一，避免各处解析不一致）', () => {
    expect(() => yuanToFen('.80')).toThrow(AmountError)
  })

  it('超出单笔上限被拒绝，报 code=AMOUNT_LIMIT', () => {
    const max = DEFAULT_MAX_AMOUNT_FEN
    expect(() => yuanToFen(String((max + 1) / 100))).toThrow(AmountError)
    try {
      yuanToFen(String((max + 1) / 100))
    } catch (e) {
      expect((e as AmountError).code).toBe('AMOUNT_LIMIT')
    }
  })

  it('上限恰好等于允许值时通过', () => {
    expect(yuanToFen(String(DEFAULT_MAX_AMOUNT_FEN / 100))).toBe(DEFAULT_MAX_AMOUNT_FEN)
  })

  it('可传入更小的自定义上限', () => {
    expect(() => yuanToFen('2.00', 100)).toThrow(AmountError)
    expect(yuanToFen('1.00', 100)).toBe(100)
  })

  it('传入非字符串（数字类型绕过 DTO 时）被拒绝', () => {
    expect(() => yuanToFen(12.8 as unknown as string)).toThrow(AmountError)
    expect(() => yuanToFen(Number.NaN as unknown as string)).toThrow(AmountError)
  })

  it('浮点累加误差场景不产生半分（0.1+0.2 类输入由字符串口径规避）', () => {
    expect(yuanToFen('0.30')).toBe(30)
    expect(yuanToFen((0.1 + 0.2).toFixed(2))).toBe(30)
  })
})

describe('fenToYuan：展示层换算', () => {
  it('输出固定两位小数', () => {
    expect(fenToYuan(1280)).toBe('12.80')
    expect(fenToYuan(1)).toBe('0.01')
    expect(fenToYuan(100)).toBe('1.00')
    expect(fenToYuan(0)).toBe('0.00')
  })

  it('拒绝非整数分（防止中途出现浮点污染账本）', () => {
    expect(() => fenToYuan(1.5)).toThrow(AmountError)
    expect(() => fenToYuan(Number.NaN)).toThrow(AmountError)
  })
})

describe('fenToYuan：负数与包入口', () => {
  it('负数分可正确展示（用于差额）', () => {
    expect(fenToYuan(-1280)).toBe('-12.80')
    expect(fenToYuan(-1)).toBe('-0.01')
  })
})
