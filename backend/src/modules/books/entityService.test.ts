// 测试文件：实体初始化快照的捕获/恢复，以及 AI 实体不覆盖用户实体的冲突保护。
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pathExists, readTextFile } from "../../utils/fileStore.js";
import { createWorkspacePaths } from "../workspace/workspacePaths.js";
import { ensureWorkspace } from "../workspace/workspaceService.js";
import { createBookPaths } from "./bookPaths.js";
import { createBook } from "./bookService.js";
import {
  captureEntityStorageSnapshot,
  listEntities,
  replaceGeneratedEntities,
  restoreEntityStorageSnapshot,
  saveEntity,
  type GeneratedEntityInput
} from "./entityService.js";

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

describe("entity initialization snapshots", () => {
  it("restores the exact user entity files and removes newly generated files", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-entity-snapshot-"));
    const paths = createWorkspacePaths(tempRoot);
    await ensureWorkspace(paths);
    const book = await createBook(paths, { title: "实体回滚测试" });
    await saveEntity(paths, book.id, {
      id: "user-role",
      entityType: "character",
      name: "用户角色",
      role: "主角",
      description: "用户手工创建",
      attributes: { source: "user" }
    });
    const bookPaths = createBookPaths(paths, book.id);
    const userFile = path.join(bookPaths.charactersDir, "user-role.md");
    const originalMarkdown = await readTextFile(userFile);
    const snapshot = await captureEntityStorageSnapshot(paths, book.id);
    const generated: GeneratedEntityInput[] = [{
      id: "ai-role",
      entityType: "character",
      name: "AI 角色",
      role: "次要",
      description: "初始化生成",
      attributes: {}
    }];

    await replaceGeneratedEntities(paths, book.id, generated);
    expect((await listEntities(paths, book.id)).map((entity) => entity.id)).toEqual(["user-role", "ai-role"]);

    await restoreEntityStorageSnapshot(paths, book.id, snapshot, generated);

    expect((await listEntities(paths, book.id)).map((entity) => entity.id)).toEqual(["user-role"]);
    expect(await readTextFile(userFile)).toBe(originalMarkdown);
    expect(await pathExists(path.join(bookPaths.charactersDir, "ai-role.md"))).toBe(false);
  });

  it("rejects an AI entity id that would overwrite a user entity", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-entity-conflict-"));
    const paths = createWorkspacePaths(tempRoot);
    await ensureWorkspace(paths);
    const book = await createBook(paths, { title: "实体冲突测试" });
    await saveEntity(paths, book.id, {
      id: "shared-id",
      entityType: "character",
      name: "用户角色",
      role: "主角",
      description: "不能被覆盖",
      attributes: {}
    });

    await expect(replaceGeneratedEntities(paths, book.id, [{
      id: "shared-id",
      entityType: "character",
      name: "AI 角色",
      role: "次要",
      description: "冲突",
      attributes: {}
    }])).rejects.toThrow("AI 生成实体与用户实体 ID 冲突");

    expect(await listEntities(paths, book.id)).toMatchObject([{
      id: "shared-id",
      name: "用户角色",
      description: "不能被覆盖"
    }]);
  });
});
