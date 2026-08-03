/**
 * 约束文本消毒器。
 * 职责：清洗风格约束/生成规则文本，阻断提示注入与不可见控制字符，并限制长度；
 * 边界：纯函数；不区分文本来源，风格约束、模型输出与场景调整一律按不可信输入处理。
 */

// 命中即视为注入：中英文角色扮演、系统提示覆盖、忽略指令、切换角色等常见攻击句式
const instructionPattern = /(?:ignore\s+(?:all|previous)|system\s*prompt|assistant\s*:|tool\s*:|忽略(?:以上|此前|所有)|你现在是|执行以下指令|切换角色)/iu;

/**
 * 降级风格和模型生成规则都按不可信文本处理，阻断明显的角色/指令注入。
 * @param value 原始约束文本
 * @param maxLength 截断长度（默认 320）
 * @returns 清洗后的文本；为空或疑似注入时返回空串，调用方应丢弃该约束
 */
export function sanitizeStyleConstraint(value: string, maxLength = 320) {
  const normalized = value
    // 剔除控制字符（保留 \t\n\r），防止模型输出中的隐藏指令字符进入 Prompt
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    // 空白统一折叠为单个空格，压缩词法噪声、降低去重误判
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized || instructionPattern.test(normalized)) return "";
  return normalized.slice(0, maxLength);
}
