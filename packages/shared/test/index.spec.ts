import { describe, expect, it } from '@jest/globals'
import * as shared from '../src/index'

describe('包入口', () => {
  it('导出金额工具与状态机常量', () => {
    expect(typeof shared.yuanToFen).toBe('function')
    expect(typeof shared.fenToYuan).toBe('function')
    expect(typeof shared.decidePayment).toBe('function')
    expect(shared.DEFAULT_MAX_AMOUNT_FEN).toBe(50000000)
    expect(shared.ALLOWED_TRANSITIONS.PAYING).toContain('PAID')
  })
})
