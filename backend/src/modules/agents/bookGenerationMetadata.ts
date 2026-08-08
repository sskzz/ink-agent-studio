/**
 * 章节生成使用的统一作品元数据投影。
 *
 * book.json 与初始化事实卡是权威存储；本模块只负责把它们投影成规划、检索、
 * 正文生成和审稿共同消费的一份只读上下文，避免各阶段各取一部分字段。
 */
import type { FactCard } from "../../schemas/factSchemas.js";
import type { BookRecord } from "../../types/domain.js";

export interface BookGenerationMetadata {
  schemaVersion: "book-generation-metadata.v1";
  bookId: string;
  title: string;
  genre: string;
  channel: string;
  narrationPerspective: string;
  protagonist: {
    name: string;
    gender: string;
  };
  plannedWords: number | null;
  chapterWords: number | null;
  writingStyle: {
    id: string | null;
    versionId: string | null;
  };
  foundation: {
    premise: string;
    coreConflict: string;
    protagonistGoal: string;
    stakes: string;
    boundaries: string[];
    readerPromises: string[];
  };
  unresolvedFields: string[];
}

/** 从作品记录和初始化事实卡构建唯一的章节生成元数据。 */
export function buildBookGenerationMetadata(book: BookRecord, factCards: FactCard[]): BookGenerationMetadata {
  const activeCards = factCards.filter((card) => card.status === "active");
  const byId = new Map(activeCards.map((card) => [card.id, card.content.trim()]));
  const collect = (prefix: string) => activeCards
    .filter((card) => card.id.startsWith(prefix))
    .sort((left, right) => left.id.localeCompare(right.id, "zh-CN", { numeric: true }))
    .map((card) => card.content.trim())
    .filter(Boolean);

  return {
    schemaVersion: "book-generation-metadata.v1",
    bookId: book.id,
    title: book.title.trim(),
    genre: book.genre.trim(),
    channel: book.channel.trim(),
    narrationPerspective: book.narrationPerspective.trim(),
    protagonist: {
      name: book.protagonistName.trim(),
      gender: book.protagonistGender.trim()
    },
    plannedWords: book.plannedWords,
    chapterWords: book.chapterWords,
    writingStyle: {
      id: book.writingStyleId,
      versionId: book.writingStyleVersionId
    },
    foundation: {
      premise: byId.get("fact:foundation-premise") ?? "",
      coreConflict: byId.get("fact:foundation-core-conflict") ?? "",
      protagonistGoal: byId.get("fact:foundation-protagonist-goal") ?? "",
      stakes: byId.get("fact:foundation-stakes") ?? "",
      boundaries: collect("fact:foundation-boundary-"),
      readerPromises: collect("fact:foundation-promise-")
    },
    unresolvedFields: [...book.needsAiFill]
  };
}

/** 渲染给模型使用的稳定文本；空字段明确标记，便于 trace 与降级诊断。 */
export function renderBookGenerationMetadata(metadata: BookGenerationMetadata) {
  const lines = [renderBookCoreMetadata(metadata)];
  const foundation = renderBookFoundation(metadata);
  if (foundation) lines.push(foundation);
  if (metadata.unresolvedFields.length) lines.push(`尚未补全字段：${metadata.unresolvedFields.join("、")}`);
  return lines.join("\n");
}

/** 仅渲染 book.json 中的稳定作品字段，供 facts 层独立设置预算。 */
export function renderBookCoreMetadata(metadata: BookGenerationMetadata) {
  const value = (input: string, fallback = "未指定") => input || fallback;
  const lines = [
    `作品：${value(metadata.title)}`,
    `题材：${value(metadata.genre)}`,
    `频道：${value(metadata.channel)}`,
    `叙事人称：${value(metadata.narrationPerspective, "沿用已有正文")}`,
    `主角：${value(metadata.protagonist.name)}（性别：${value(metadata.protagonist.gender)}）`,
    `预计总字数：${metadata.plannedWords ? `约 ${metadata.plannedWords} 字` : "未指定"}`,
    `单章目标：${metadata.chapterWords ? `约 ${metadata.chapterWords} 字` : "按本次指令合理续写"}`,
    `写作风格：${metadata.writingStyle.id ?? "未绑定"}${metadata.writingStyle.versionId ? `（版本 ${metadata.writingStyle.versionId}）` : ""}`
  ];
  return lines.join("\n");
}

/** 渲染初始化事实卡中的故事基石、边界与读者承诺。 */
export function renderBookFoundation(metadata: BookGenerationMetadata) {
  return [
    metadata.foundation.premise ? `故事前提：${metadata.foundation.premise}` : "",
    metadata.foundation.coreConflict ? `核心冲突：${metadata.foundation.coreConflict}` : "",
    metadata.foundation.protagonistGoal ? `主角目标：${metadata.foundation.protagonistGoal}` : "",
    metadata.foundation.stakes ? `失败代价：${metadata.foundation.stakes}` : "",
    ...metadata.foundation.boundaries.map((item) => `创作边界：${item}`),
    ...metadata.foundation.readerPromises.map((item) => `读者承诺：${item}`)
  ].filter(Boolean).join("\n");
}
