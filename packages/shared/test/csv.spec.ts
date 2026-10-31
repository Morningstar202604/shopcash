import { describe, expect, it } from '@jest/globals'
import { csvCell, toCsv } from '../src/csv'

describe('CSV 转义与公式注入防护', () => {
  it('普通值原样输出', () => {
    expect(csvCell('SC20261031000001')).toBe('SC20261031000001')
    expect(csvCell(12.8)).toBe('12.8')
  })

  it('逗号、引号、换行触发加引号并转义', () => {
    expect(csvCell('含,逗号')).toBe('"含,逗号"')
    expect(csvCell('说"话"')).toBe('"说""话"""')
    expect(csvCell('第一行\n第二行')).toBe('"第一行\n第二行"')
  })

  it('公式前缀一律加单引号前缀，避免 Excel 执行', () => {
    expect(csvCell('=HYPERLINK("http://x","点我")')).toBe(`"'=HYPERLINK(""http://x"",""点我"")"`)
    expect(csvCell('+1+1')).toBe(`'+1+1`)
    expect(csvCell('-2+3')).toBe(`'-2+3`)
    expect(csvCell('@SUM(A1)')).toBe(`'@SUM(A1)`)
  })

  it('null / undefined 输出空串而不是 "null"', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('toCsv 带 UTF-8 BOM、CRLF 行尾、表头在首行', () => {
    const out = toCsv(['订单号', '备注'], [['SC1', 'a,b']])
    expect(out.startsWith('\ufeff')).toBe(true)
    expect(out).toBe('\ufeff订单号,备注\r\nSC1,"a,b"')
  })
})
