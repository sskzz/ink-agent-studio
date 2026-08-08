import { describe, expect, it } from "vitest";
import type { FactCard } from "../../schemas/factSchemas.js";
import type { BookRecord } from "../../types/domain.js";
import { buildBookGenerationMetadata, renderBookGenerationMetadata } from "./bookGenerationMetadata.js";

const book: BookRecord = {
  id: "book-1",
  title: "她们的外挂，我的日常",
  genre: "轻小说、青春、恋爱、异能",
  status: "drafting",
  narrationPerspective: "第三人称",
  channel: "男频",
  writingStyleId: "style-1",
  writingStyleVersionId: "version-1",
  protagonistGender: "男",
  protagonistName: "苏见",
  plannedWords: 800000,
  chapterWords: 3500,
  writtenWords: 0,
  writtenChapters: 0,
  currentChapterId: null,
  worldFileId: null,
  needsAiFill: [],
  createdAt: "",
  updatedAt: ""
};

function card(id: string, content: string): FactCard {
  return { schemaVersion: "fact-card.v1", id, kind: "setting", version: 1, status: "active", mutability: "immutable", source: "ai-foundation", content, refs: [], constraints: [] };
}

describe("bookGenerationMetadata", () => {
  it("统一投影作品字段、基础设定、创作边界与风格版本", () => {
    const metadata = buildBookGenerationMetadata(book, [
      card("fact:foundation-premise", "苏见能看见他人的系统面板"),
      card("fact:foundation-core-conflict", "能力只读不可修改"),
      card("fact:foundation-boundary-1", "不能让外挂代替人物选择")
    ]);
    const prompt = renderBookGenerationMetadata(metadata);

    expect(metadata.protagonist).toEqual({ name: "苏见", gender: "男" });
    expect(prompt).toContain("频道：男频");
    expect(prompt).toContain("主角：苏见（性别：男）");
    expect(prompt).toContain("故事前提：苏见能看见他人的系统面板");
    expect(prompt).toContain("创作边界：不能让外挂代替人物选择");
    expect(prompt).toContain("写作风格：style-1（版本 version-1）");
  });
});
