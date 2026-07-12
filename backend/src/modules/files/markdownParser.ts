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
    .map((line) => /^(#{1,6})\s+(.+)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => ({
      level: match[1].length,
      text: match[2].trim()
    }));

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
