/**
 * 验证工具函数
 *
 * 所有 schema 验证函数返回 string[]：空数组 = 有效，非空 = 错误列表。
 */

export type ValidationErrors = string[]

/** 推入一条错误（条件不满足时） */
export function check(
  condition: boolean,
  errors: ValidationErrors,
  message: string,
): void {
  if (!condition) {
    errors.push(message)
  }
}

/** 检查值是否为有限数字 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 检查值是否为指定范围内的有限数字 */
export function inRange(
  value: unknown,
  min: number,
  max: number,
): boolean {
  return isFiniteNumber(value) && value >= min && value <= max
}

/** 检查值是否为非空字符串 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** 检查值是否为 boolean */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

/** 检查值是否为指定枚举成员 */
export function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}
