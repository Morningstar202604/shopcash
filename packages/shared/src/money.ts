/**
 * 金额换算 —— 全项目唯一允许的元↔分入口（PRD 12.1）
 *
 * 口径：
 *  - DB 一律以「分」为整数存储，元只出现在 API 出入参与界面输入
 *  - 输入必须是纯十进制字符串（最多 7 位整数 + 2 位小数），拒绝科学计数法、千分位、货币符号
 *  - 超过两位小数一律拒绝，不做四舍五入（fail-closed，避免"少收多入"类误差被静默吞掉）
 *  - 金额必须 > 0 且 ≤ 单笔上限
 */

export class AmountError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AmountError'
  }
}

/** 单笔金额默认上限（分）＝ 50 万元；可被 /settings 的值覆盖 */
export const DEFAULT_MAX_AMOUNT_FEN = 50000000

/** 1~7 位整数，可选 .1~2 位小数 */
const AMOUNT_PATTERN = /^\d{1,7}(\.\d{1,2})?$/

/**
 * 元 → 分。用字符串分段计算，避免 `Math.round(x*100)` 把非法精度静默归整。
 * @param input 用户/接口传入的金额字符串
 * @param maxFen 单笔上限（分），来自运行参数
 * @throws AmountError AMOUNT_DECIMAL_INVALID | AMOUNT_TOO_SMALL | AMOUNT_LIMIT
 */
export function yuanToFen(
  input: string,
  maxFen: number = DEFAULT_MAX_AMOUNT_FEN,
): number {
  if (typeof input !== 'string') {
    throw new AmountError('AMOUNT_DECIMAL_INVALID', '金额必须为字符串，禁止直接传数字')
  }

  const text = input.trim()
  if (!AMOUNT_PATTERN.test(text)) {
    throw new AmountError(
      'AMOUNT_DECIMAL_INVALID',
      '金额格式非法：仅允许十进制数字，最多两位小数',
    )
  }

  // 正则已把整数位限死在 7 位内，换算结果必然落在安全整数区间，无需额外溢出检查
  const [intPart, decPart = ''] = text.split('.')
  const cents = decPart.length === 0 ? 0 : Number(decPart.padEnd(2, '0'))
  const fen = Number(intPart) * 100 + cents

  if (fen <= 0) {
    throw new AmountError('AMOUNT_TOO_SMALL', '金额必须大于 0')
  }
  if (fen > maxFen) {
    throw new AmountError('AMOUNT_LIMIT', `金额超出单笔上限 ${maxFen} 分`)
  }
  return fen
}

/**
 * 分 → 元（展示用字符串，固定两位小数）。
 * @throws AmountError AMOUNT_FEN_INVALID 当入参不是整数分
 */
export function fenToYuan(fen: number): string {
  if (!Number.isInteger(fen)) {
    throw new AmountError('AMOUNT_FEN_INVALID', '分数必须为整数，禁止浮点污染账本')
  }
  const sign = fen < 0 ? '-' : ''
  const abs = Math.abs(fen)
  const yuan = Math.trunc(abs / 100)
  const cents = String(abs % 100).padStart(2, '0')
  return `${sign}${yuan}.${cents}`
}
