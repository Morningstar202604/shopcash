import { describe, expect, it } from '@jest/globals'
import {
  ALLOWED_TRANSITIONS,
  assertTransition,
  decidePayment,
  IllegalTransitionError,
  type OrderStatus,
} from '../src/order-state'

const PAID_ORDER = { status: 'PAID' as OrderStatus, amountFen: 1280 }
const PENDING_ORDER = { status: 'PENDING' as OrderStatus, amountFen: 1280 }
const PAYING_ORDER = { status: 'PAYING' as OrderStatus, amountFen: 1280 }
const CLOSED_ORDER = { status: 'CLOSED' as OrderStatus, amountFen: 1280 }

describe('硬规则 1：金额强校验（fail-closed）', () => {
  it('渠道实付金额与订单金额相等才允许 PAID', () => {
    const d = decidePayment(PAYING_ORDER, { status: 'SUCCESS', amountFen: 1280 })
    expect(d.to).toBe('PAID')
    expect(d.changed).toBe(true)
  })

  it('金额少一分也进 EXCEPTION(AMOUNT_MISMATCH)，不置 PAID（13.2 用例 1）', () => {
    const d = decidePayment(PAYING_ORDER, { status: 'SUCCESS', amountFen: 1279 })
    expect(d.to).toBe('EXCEPTION')
    expect(d.exceptionReason).toBe('AMOUNT_MISMATCH')
  })

  it('金额多也进 EXCEPTION——多收同样是账不平', () => {
    const d = decidePayment(PAYING_ORDER, { status: 'SUCCESS', amountFen: 1281 })
    expect(d.exceptionReason).toBe('AMOUNT_MISMATCH')
  })

  it('渠道未返回金额一律拒绝确认（13.2 用例 2）', () => {
    const d = decidePayment(PAYING_ORDER, { status: 'SUCCESS', amountFen: null })
    expect(d.to).toBe('EXCEPTION')
    expect(d.exceptionReason).toBe('AMOUNT_MISMATCH')
  })

  it('本地订单金额非正数属调用错误，必须抛错而非静默处理', () => {
    expect(() =>
      decidePayment({ status: 'PAYING', amountFen: 0 }, { status: 'SUCCESS', amountFen: 0 }),
    ).toThrow(RangeError)
  })
})

describe('硬规则 2：迟到的成功只进人工', () => {
  it('已 CLOSED 后查到成功 → EXCEPTION(LATE_SUCCESS)，绝不自动 PAID（13.2 用例 3）', () => {
    const d = decidePayment(CLOSED_ORDER, { status: 'SUCCESS', amountFen: 1280 })
    expect(d.to).toBe('EXCEPTION')
    expect(d.exceptionReason).toBe('LATE_SUCCESS')
  })

  it('已 PAID 后重复成功结果 → 幂等不变（13.2 用例 5）', () => {
    const d = decidePayment(PAID_ORDER, { status: 'SUCCESS', amountFen: 1280 })
    expect(d.to).toBe('PAID')
    expect(d.changed).toBe(false)
  })

  it('已 EXCEPTION 后任何结果都不自动改状态（规则 2 的对称约束）', () => {
    const d = decidePayment(
      { status: 'EXCEPTION', amountFen: 1280 },
      { status: 'SUCCESS', amountFen: 1280 },
    )
    expect(d.to).toBe('EXCEPTION')
    expect(d.changed).toBe(false)
  })

  it('已 REFUNDED 后重复成功结果不复活订单', () => {
    const d = decidePayment(
      { status: 'REFUNDED', amountFen: 1280 },
      { status: 'SUCCESS', amountFen: 1280 },
    )
    expect(d.to).toBe('REFUNDED')
    expect(d.changed).toBe(false)
  })

  it('REFUNDING 期间重复到账不把订单退回 PAID', () => {
    const d = decidePayment(
      { status: 'REFUNDING', amountFen: 1280 },
      { status: 'SUCCESS', amountFen: 1280 },
    )
    expect(d.to).toBe('REFUNDING')
    expect(d.changed).toBe(false)
  })
})

describe('失败与未知结果', () => {
  it('渠道明确失败：PAYING 保持 PAYING，等待超时关单或用户重付', () => {
    const d = decidePayment(PAYING_ORDER, { status: 'FAILED', amountFen: 1280 })
    expect(d.to).toBe('PAYING')
    expect(d.changed).toBe(false)
  })

  it('渠道结果未知：状态不变，交下一轮轮询', () => {
    const d = decidePayment(PENDING_ORDER, { status: 'UNKNOWN', amountFen: null })
    expect(d.to).toBe('PENDING')
    expect(d.changed).toBe(false)
  })

  it('已 CLOSED 收到失败结果：保持 CLOSED，不产生异常单', () => {
    const d = decidePayment(CLOSED_ORDER, { status: 'FAILED', amountFen: null })
    expect(d.to).toBe('CLOSED')
    expect(d.changed).toBe(false)
  })

  it('PENDING 直接成功（回调早于本地置 PAYING）允许置 PAID', () => {
    const d = decidePayment(PENDING_ORDER, { status: 'SUCCESS', amountFen: 1280 })
    expect(d.to).toBe('PAID')
  })
})

describe('流转表与 assertTransition', () => {
  it('合法流转逐一放行', () => {
    const legal: Array<[OrderStatus, OrderStatus]> = [
      ['PENDING', 'PAYING'],
      ['PENDING', 'CLOSED'],
      ['PENDING', 'PAID'],
      ['PENDING', 'EXCEPTION'],
      ['PAYING', 'PAID'],
      ['PAYING', 'CLOSED'],
      ['PAYING', 'EXCEPTION'],
      ['PAID', 'REFUNDING'],
      ['PAID', 'EXCEPTION'],
      ['REFUNDING', 'REFUNDED'],
      ['REFUNDING', 'PAID'],
      ['REFUNDING', 'EXCEPTION'],
      ['CLOSED', 'EXCEPTION'],
      ['EXCEPTION', 'PAID'],
      ['EXCEPTION', 'CLOSED'],
      ['EXCEPTION', 'REFUNDED'],
    ]
    for (const [from, to] of legal) {
      expect(() => assertTransition(from, to)).not.toThrow()
      expect(ALLOWED_TRANSITIONS[from]).toContain(to)
    }
  })

  it('非法流转抛 IllegalTransitionError（PENDING → REFUNDED 等）', () => {
    expect(() => assertTransition('PENDING', 'REFUNDED')).toThrow(IllegalTransitionError)
    expect(() => assertTransition('REFUNDED', 'PAID')).toThrow(IllegalTransitionError)
    expect(() => assertTransition('PAID', 'PENDING')).toThrow(IllegalTransitionError)
    expect(() => assertTransition('CLOSED', 'PAID')).toThrow(IllegalTransitionError)
  })

  it('自环不在流转表内（幂等短路由 decidePayment 负责，不靠放宽表）', () => {
    for (const s of Object.keys(ALLOWED_TRANSITIONS) as OrderStatus[]) {
      expect(ALLOWED_TRANSITIONS[s]).not.toContain(s)
    }
  })

  it('EXCEPTION 是唯一出口受限的态：不允许回到 PENDING/PAYING', () => {
    expect(ALLOWED_TRANSITIONS.EXCEPTION).not.toContain('PENDING')
    expect(ALLOWED_TRANSITIONS.EXCEPTION).not.toContain('PAYING')
  })
})
