export const DEFAULT_QUERY_BACKOFF_MS = [3000, 10000, 30000, 120000, 300000]
export const DEFAULT_ORDER_EXPIRE_MINUTES = 15

export function queryAtMs(
  createdAtMs: number,
  attempt: number,
  backoff: number[] = DEFAULT_QUERY_BACKOFF_MS,
): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError(`attempt 必须为正整数，实际 ${attempt}`)
  if (!backoff.length) throw new RangeError('退避序列不能为空')
  const tail = backoff[backoff.length - 1]
  let offset = 0
  for (let i = 0; i < Math.min(attempt, backoff.length); i += 1) offset += backoff[i]
  if (attempt > backoff.length) offset += tail * (attempt - backoff.length)
  return createdAtMs + offset
}
