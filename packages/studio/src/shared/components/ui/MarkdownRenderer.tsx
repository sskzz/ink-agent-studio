import type { ReactNode } from "react";

interface MarkdownRendererProps {
  content: string;
}

/**
 * 轻量 Markdown 渲染组件（共享）。
 *
 * 第一版只做前端预览，不引入外部依赖：
 * - 块级：标题（1-3 级）、段落、无序/有序列表、引用、代码块、分割线、GFM 表格。
 * - 行内：加粗、行内代码。
 * 后续如需完整 GFM 可整体替换为 markdown-it/remark 管线，本组件接口保持不变。
 */
export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return <div className="markdown-preview">{renderMarkdownBlocks(content)}</div>;
}

/** GFM 表格行切分：按未转义的 | 拆列，并去掉首尾空列（管道符不在行首尾时没有）。 */
function splitTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

/** 识别 GFM 表格分隔行（如 | --- | :---: |），返回 null 表示不是分隔行。 */
function isTableSeparatorRow(line: string) {
  const cells = splitTableRow(line);
  if (cells.length < 2) return null;
  const pattern = /^:?-{3,}:?$/;
  return cells.every((cell) => pattern.test(cell)) ? cells.length : null;
}

/** 解析表格块：识别 header 行 + 分隔行，收集到下一个空行或非表格行。 */
function parseTableBlock(lines: string[], startIndex: number): { block: ReactNode; nextIndex: number } | null {
  const headerCells = splitTableRow(lines[startIndex] ?? "");
  const separatorColumnCount = isTableSeparatorRow(lines[startIndex + 1] ?? "");
  if (separatorColumnCount === null) return null;

  let index = startIndex + 2;
  const bodyRows: string[][] = [];
  while (index < lines.length) {
    const line = (lines[index] ?? "").trim();
    if (!line) break;
    if (line.startsWith("```") || /^#{1,3}\s+/.test(line) || /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) break;
    const cells = splitTableRow(line);
    if (cells.length < 2) break;
    bodyRows.push(cells);
    index += 1;
  }

  const columnCount = Math.max(headerCells.length, separatorColumnCount);
  const block = (
    <div className="markdown-table-wrap" key={`table-${startIndex}`}>
      <table>
        <thead>
          <tr>{headerCells.map((cell) => <th key={cell}>{renderInlineMarkdown(cell)}</th>)}</tr>
        </thead>
        <tbody>
          {bodyRows.map((row, rowIndex) => (
            <tr key={`${startIndex}-${rowIndex}`}>
              {Array.from({ length: columnCount }, (_, columnIndex) => (
                <td key={columnIndex}>{renderInlineMarkdown(row[columnIndex] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return { block, nextIndex: index };
}

/** 把 markdown 文本切分为块级 ReactNode 序列：按行扫描，逐块识别并消费连续行。 */
function renderMarkdownBlocks(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmedLine = line.trim();

    // 空行跳过：段落之间用空行分隔，本身不产出节点。
    if (!trimmedLine) {
      index += 1;
      continue;
    }

    // GFM 表格：表头行 + 分隔行，收集数据行直到空行或非表格内容。
    if (lines[index]?.includes("|")) {
      const table = parseTableBlock(lines, index);
      if (table) {
        blocks.push(table.block);
        index = table.nextIndex;
        continue;
      }
    }

    // 代码块：以 ``` 开头，收集到下一个 ``` 为止，内部内容原样输出。
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

    // 分割线：一行纯 --- 视为水平线。
    if (/^---+$/.test(trimmedLine)) {
      blocks.push(<hr key={`hr-${index}`} />);
      index += 1;
      continue;
    }

    // 标题：支持 1-3 级，行内语法交给行内渲染器处理。
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

    // 引用：连续以 > 开头的行合并为一个 blockquote。
    if (trimmedLine.startsWith(">")) {
      const quoteLines: string[] = [];

      while (index < lines.length && (lines[index] ?? "").trim().startsWith(">")) {
        quoteLines.push((lines[index] ?? "").trim().replace(/^>\s?/, ""));
        index += 1;
      }

      blocks.push(<blockquote key={`quote-${index}`}>{quoteLines.map((item) => renderInlineMarkdown(item))}</blockquote>);
      continue;
    }

    // 无序列表：连续以 -/* 开头的行合并为一个 ul。
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

    // 有序列表：连续以 "数字." 开头的行合并为一个 ol。
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

    // 普通段落：连续非空且不是其他块起始符的行合并为一个 p。
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

/** 行内渲染：识别 **加粗** 与 `行内代码`，其余文本原样输出。 */
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
