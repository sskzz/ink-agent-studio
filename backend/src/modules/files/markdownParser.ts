/**
 * 文件职责：轻量 Markdown 解析（标题、字数、摘要），用于文件索引与展示。
 * 边界：不构建 AST、不做语义分析；后续需要精确结构化数据时替换为 markdown 解析库。
 */
export interface MarkdownParseResult {
  headings: Array<{ level: number; text: string }>;
  wordCount: number;
  summary: string;
}

/**
 * 轻量 Markdown 解析。
 * 第一版只提取标题、粗略字数和摘要；后续可替换为 markdown AST 解析库。
 */
export function parseMarkdown(content: string): MarkdownParseResult {
  const headings = content
    .split(/\r?\n/)
    // 只匹配 1-6 级标题（# 后必须有空格），避免误匹配到代码块内的井号
    .map((line) => /^(#{1,6})\s+(.+)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => ({
      level: match[1].length,
      text: match[2].trim()
    }));

  // 粗略正文：剔除代码块与 Markdown 标记，只保留可见文本用于字数和摘要
  const plainText = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`|[\]()\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    headings,
    wordCount: plainText.length,
    summary: plainText.slice(0, 160)
  };
}
