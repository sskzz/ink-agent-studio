import { createHash } from "node:crypto";

/**
 * 计算内容 hash。
 * Markdown 文件保存后记录 hash，后续可以判断是否需要重新解析或重新生成摘要。
 */
export function sha256(content: string) {
  return createHash("sha256").update(content).digest("hex");
}
