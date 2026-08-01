const instructionPattern = /(?:ignore\s+(?:all|previous)|system\s*prompt|assistant\s*:|tool\s*:|忽略(?:以上|此前|所有)|你现在是|执行以下指令|切换角色)/iu;

/** 降级风格和模型生成规则都按不可信文本处理，阻断明显的角色/指令注入。 */
export function sanitizeStyleConstraint(value: string, maxLength = 320) {
  const normalized = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized || instructionPattern.test(normalized)) return "";
  return normalized.slice(0, maxLength);
}
