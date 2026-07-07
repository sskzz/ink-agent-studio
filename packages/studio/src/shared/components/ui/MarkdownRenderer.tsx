import type { ReactNode } from "react";

interface MarkdownRendererProps {
  content: string;
}

/**
 * 轻量 Markdown 渲染组件。
 *
 * 第一版只做前端预览，不引入外部依赖：
 * - 支持标题、段落、无序列表、有序列表、引用、代码块、分割线。
 * - 支持行内加粗和行内代码。
 * 后续如果需要完整 GFM，可以替换为统一的 markdown-it/remark 渲染管线。
 */
export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return <div className="markdown-preview">{renderMarkdownBlocks(content)}</div>;
}

function renderMarkdownBlocks(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      index += 1;
      continue;
    }

    if (trimmedLine.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }

      blocks.push(
        <pre className="markdown-code-block" key={`code-${index}`}>
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      index += 1;
      continue;
    }

    if (/^---+$/.test(trimmedLine)) {
      blocks.push(<hr key={`hr-${index}`} />);
      index += 1;
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmedLine);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];

      if (level === 1) {
        blocks.push(<h1 key={`h1-${index}`}>{renderInlineMarkdown(text)}</h1>);
      } else if (level === 2) {
        blocks.push(<h2 key={`h2-${index}`}>{renderInlineMarkdown(text)}</h2>);
      } else {
        blocks.push(<h3 key={`h3-${index}`}>{renderInlineMarkdown(text)}</h3>);
      }

      index += 1;
      continue;
    }

    if (trimmedLine.startsWith(">")) {
      const quoteLines: string[] = [];

      while (index < lines.length && (lines[index] ?? "").trim().startsWith(">")) {
        quoteLines.push((lines[index] ?? "").trim().replace(/^>\s?/, ""));
        index += 1;
      }

      blocks.push(<blockquote key={`quote-${index}`}>{quoteLines.map((item) => renderInlineMarkdown(item))}</blockquote>);
      continue;
    }

    if (/^[-*]\s+/.test(trimmedLine)) {
      const items: string[] = [];

      while (index < lines.length && /^[-*]\s+/.test((lines[index] ?? "").trim())) {
        items.push((lines[index] ?? "").trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }

      blocks.push(
        <ul key={`ul-${index}`}>
          {items.map((item) => (
            <li key={item}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmedLine)) {
      const items: string[] = [];

      while (index < lines.length && /^\d+\.\s+/.test((lines[index] ?? "").trim())) {
        items.push((lines[index] ?? "").trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }

      blocks.push(
        <ol key={`ol-${index}`}>
          {items.map((item) => (
            <li key={item}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && (lines[index] ?? "").trim()) {
      const currentLine = (lines[index] ?? "").trim();

      if (
        currentLine.startsWith("```") ||
        /^#{1,3}\s+/.test(currentLine) ||
        currentLine.startsWith(">") ||
        /^[-*]\s+/.test(currentLine) ||
        /^\d+\.\s+/.test(currentLine) ||
        /^---+$/.test(currentLine)
      ) {
        break;
      }

      paragraphLines.push(currentLine);
      index += 1;
    }

    blocks.push(<p key={`p-${index}`}>{renderInlineMarkdown(paragraphLines.join(" "))}</p>);
  }

  return blocks;
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
    }

    return part;
  });
}
