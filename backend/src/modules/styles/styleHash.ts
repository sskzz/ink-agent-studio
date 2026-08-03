/**
 * 风格内容哈希。
 * 职责：对任意风格值做稳定的 SHA-256 哈希，用于内容寻址（版本去重、编译缓存键、样本去重）；
 * 边界：纯函数；关键点是 stableStringify——对象键先排序再序列化，保证相同内容的哈希恒定（与键序无关）。
 */
import { createHash } from "node:crypto";

/** 对风格值做 SHA-256 哈希（先稳定序列化）。 */
export function hashStyleValue(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

/** 稳定序列化：数组保持顺序；对象键按字典序排序后输出，保证内容相同则字符串相同。 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
