/**
 * 订单状态机与到账判定 —— PRD 5.3 / 第 16 章的三条硬规则的唯一实现处
 *
 * 硬规则 1：渠道实付金额必须与订单金额完全相等才允许 PAID，否则 EXCEPTION(AMOUNT_MISMATCH)
 * 硬规则 2：已 CLOSED 的订单事后查到成功，只进 EXCEPTION(LATE_SUCCESS)，绝不自动 PAID
 * 硬规则 3：状态推进必须走条件原子更新（本文件只判定目标态，SQL 守卫在仓储层）
 *
 * 纯函数、无 I/O，便于穷举测试。终态（PAID/REFUNDED/EXCEPTION）一律幂等短路，
 * 不靠放宽流转表来容忍重复回调。
 */

export type OrderStatus =
  | 'PENDING'
  | 'PAYING'
  | 'PAID'
  | 'CLOSED'
  | 'REFUNDING'
  | 'REFUNDED'
  | 'EXCEPTION'

export type ExceptionReason =
  | 'AMOUNT_MISMATCH'
  | 'LATE_SUCCESS'
  | 'NO_CALLBACK'
  | 'PARSE_FAIL'
  | 'MANUAL'
  | 'REFUND_FAILED'

export interface ChannelPayResult {
  /** SUCCESS=渠道确认付款成功；FAILED=渠道明确失败；UNKNOWN=渠道未给终态 */
  status: 'SUCCESS' | 'FAILED' | 'UNKNOWN'
  /** 渠道实付金额（分）；渠道未返回时为 null（null 一律视为不可信） */
  amountFen: number | null
  channelOrderNo?: string | null
}

export interface PaymentDecision {
  to: OrderStatus
  /** false 表示不应产生任何 UPDATE */
  changed: boolean
  exceptionReason?: ExceptionReason
  note: string
}

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: OrderStatus,
    public readonly to: OrderStatus,
  ) {
    super(`非法状态流转: ${from} -> ${to}`)
    this.name = 'IllegalTransitionError'
  }
}

/** 流转表：不含自环；EXCEPTION 只能由人工结案流向 PAID/CLOSED/REFUNDED */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['PAYING', 'PAID', 'CLOSED', 'EXCEPTION'],
  PAYING: ['PAID', 'CLOSED', 'EXCEPTION'],
  PAID: ['REFUNDING', 'EXCEPTION'],
  CLOSED: ['EXCEPTION'],
  REFUNDING: ['REFUNDED', 'PAID', 'EXCEPTION'],
  REFUNDED: [],
  EXCEPTION: ['PAID', 'CLOSED', 'REFUNDED'],
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new IllegalTransitionError(from, to)
  }
}

/**
 * 依据订单当前状态 + 渠道返回结果，判定应推进到的目标态。
 * 调用方拿到 changed=true 后，必须以
 *   UPDATE orders SET status = ? WHERE id = ? AND status = <order.status>
 * 的形式落库（受影响行数 0 即并发冲突，放弃本次推进）。
 */
export function decidePayment(
  order: { status: OrderStatus; amountFen: number },
  result: ChannelPayResult,
): PaymentDecision {
  if (!Number.isInteger(order.amountFen) || order.amountFen <= 0) {
    throw new RangeError(`订单金额非法：必须为正整数分，实际 ${order.amountFen}`)
  }

  // 终态/待人工态：任何结果都不再自动推进
  if (order.status === 'PAID') {
    return { to: 'PAID', changed: false, note: '订单已是终态 PAID，重复结果幂等忽略' }
  }
  if (order.status === 'REFUNDED') {
    return { to: 'REFUNDED', changed: false, note: '订单已全额退款，忽略后续结果' }
  }
  if (order.status === 'EXCEPTION') {
    return { to: 'EXCEPTION', changed: false, note: '异常单须店主人工结案' }
  }
  // 退款进行中：重复到账通知不得把订单退回 PAID（退款流程拥有状态所有权）
  if (order.status === 'REFUNDING') {
    return { to: 'REFUNDING', changed: false, note: '退款处理中，忽略支付结果' }
  }

  // 非成功结果：保持原态，交给超时关单或下一轮轮询
  if (result.status === 'FAILED') {
    return { to: order.status, changed: false, note: '渠道明确失败，保持原态等待关单或顾客重试' }
  }
  if (result.status === 'UNKNOWN') {
    return { to: order.status, changed: false, note: '渠道结果未知，保持原态继续轮询' }
  }

  // 成功结果 —— 硬规则 2 优先：已关单的迟到成功只进人工
  if (order.status === 'CLOSED') {
    assertTransition(order.status, 'EXCEPTION')
    return {
      to: 'EXCEPTION',
      changed: true,
      exceptionReason: 'LATE_SUCCESS',
      note: '订单已关闭后查到支付成功，转人工处理（禁止自动入账）',
    }
  }

  // 硬规则 1：金额强校验，缺失金额同样拒绝
  if (result.amountFen === null || result.amountFen !== order.amountFen) {
    assertTransition(order.status, 'EXCEPTION')
    return {
      to: 'EXCEPTION',
      changed: true,
      exceptionReason: 'AMOUNT_MISMATCH',
      note: `实付金额 ${result.amountFen ?? '（渠道未返回）'} 与订单金额 ${order.amountFen} 不一致，拒绝确认`,
    }
  }

  assertTransition(order.status, 'PAID')
  return { to: 'PAID', changed: true, note: '渠道确认成功且金额一致，置为已支付' }
}
