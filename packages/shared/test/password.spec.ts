import { describe, expect, it } from '@jest/globals'
import { checkPassword, isWeakPassword, WEAK_PASSWORDS } from '../src/password'

describe('口令策略', () => {
  it('长度、大小写、数字、非用户名四项齐全才通过', () => {
    expect(checkPassword('Shop2026test', 'owner').ok).toBe(true)
  })

  it('README 点名封禁的两条写法必须被拒绝', () => {
    for (const pw of ['ChangeAdmin2026', 'Admin@2026']) {
      const r = checkPassword(pw, 'owner')
      expect(r.ok).toBe(false)
      expect(r.failed).toContain('不是常见弱口令')
    }
  })

  it('弱口令表大小写不敏感，且覆盖子串变体', () => {
    expect(isWeakPassword('CHANGEADMIN2026')).toBe(true)
    expect(isWeakPassword('xx-changeadmin2026-yy')).toBe(true)
    expect(isWeakPassword('Shop2026test')).toBe(false)
    for (const w of WEAK_PASSWORDS) expect(checkPassword(w, 'owner').ok).toBe(false)
  })

  it('少于 10 位、缺大写、缺数字分别给出对应失败项', () => {
    expect(checkPassword('Abc12345', 'owner').failed).toContain('至少 10 位')
    expect(checkPassword('abc1234567', 'owner').failed).toContain('含大写与小写')
    expect(checkPassword('Abcdefghij', 'owner').failed).toContain('含数字')
  })

  it('口令与用户名相同（忽略大小写）被拒绝', () => {
    expect(checkPassword('Owner12345', 'owner12345').failed).toContain('不等于用户名')
  })

  it('空口令全部拒绝', () => {
    expect(checkPassword('', 'owner').ok).toBe(false)
    expect(isWeakPassword('   ')).toBe(true)
  })

  it('未给用户名时空值不误判为同名', () => {
    expect(checkPassword('Shop2026test', '').ok).toBe(true)
  })
})
