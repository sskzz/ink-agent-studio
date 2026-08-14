/**
 * 文件职责：作品实体（角色/势力/地点/物品）服务：CRUD、Markdown 文件维护、
 * AI 初始化实体的替换（保护用户实体）与实体存储快照的捕获/恢复（供初始化失败回滚）。
 * 边界：不涉及 AI 生成本身，只负责持久化与一致性。
 */
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { bookEntitiesIndexSchema, entityUpsertInputSchema } from "../../schemas/entitySchemas.js";
import type { BookEntityRecord, EntityType } from "../../types/domain.js";
import { conflict, notFound } from "../../utils/errors.js";
import { pathExists, readTextFile, writeTextFileAtomic } from "../../utils/fileStore.js";
import { readJsonFile, writeJsonFile } from "../../utils/jsonStore.js";
import { resolveInsideRoot } from "../../utils/safePath.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { createBookPaths } from "./bookPaths.js";
import { getBook } from "./bookRepository.js";
import { normalizeCharacterProfile, readCharacterProfile } from "./storyKnowledgeRepository.js";

/** 实体类型到作品目录的映射。 */
function getEntityDir(workspacePaths: WorkspacePaths, bookId: string, entityType: EntityType) {
  const paths = createBookPaths(workspacePaths, bookId);
  const dirMap: Record<EntityType, string> = {
    character: paths.charactersDir,
    faction: paths.factionsDir,
    location: paths.locationsDir,
    item: paths.itemsDir
  };
  return dirMap[entityType];
}

/** 实体类型英文值到中文展示名的映射，用于实体 Markdown 文档的“类型”栏。 */
const entityTypeLabels: Record<EntityType, string> = {
  character: "角色",
  faction: "势力",
  location: "地点",
  item: "物品"
};

/** 生成实体的 Markdown 文件内容（名称/类型/定位/描述）。 */
function createEntityMarkdown(entity: BookEntityRecord) {
  const profile = readCharacterProfile(entity);
  const characterProfile = profile ? `
## 五层角色档案
### 基础档案
- 外貌：${profile.core.appearance || "待补充"}
- 性格：${profile.core.personalityTraits.join("；") || "待补充"}
- 动机：${profile.core.motivations.join("；") || "待补充"}
- 禁止行为：${profile.core.prohibitedActions.join("；") || "无"}

### 成长轨迹
- 起点：${profile.arc.startState || "待补充"}
- 目标：${profile.arc.targetState || "待补充"}

### 时间线当前状态
${profile.timeline.currentState || "待补充"}

### 对话 DNA
- 声线：${profile.dialogueDna.voice || "待补充"}
- 节奏：${profile.dialogueDna.sentenceRhythm || "待补充"}
` : "";
  return `# ${entity.name}

## 类型
${entityTypeLabels[entity.entityType] ?? entity.entityType}

## 定位
${entity.role || "待补充"}

## 描述
${entity.description || "待补充"}
${characterProfile}
`;
}

/** AI 初始化流程生成的实体输入（含固定 id，便于幂等替换）。 */
export interface GeneratedEntityInput {
  id: string;
  entityType: EntityType;
  name: string;
  role: string;
  description: string;
  attributes: Record<string, unknown>;
}

/** 实体存储快照：索引 + 每个实体的 Markdown 内容（缺失文件记为 null），用于失败回滚。 */
export interface EntityStorageSnapshot {
  entities: BookEntityRecord[];
  files: Array<{
    id: string;
    entityType: EntityType;
    content: string | null;
  }>;
}

/** 实体 Markdown 文件路径：{实体目录}/{id}.md。 */
function entityMarkdownPath(workspacePaths: WorkspacePaths, bookId: string, entityType: EntityType, entityId: string) {
  return resolveInsideRoot(getEntityDir(workspacePaths, bookId, entityType), `${entityId}.md`);
}

/** 读取实体索引；同时校验作品存在。 */
async function readEntities(workspacePaths: WorkspacePaths, bookId: string) {
  await getBook(workspacePaths, bookId);
  return readJsonFile(createBookPaths(workspacePaths, bookId).entitiesIndexFile, bookEntitiesIndexSchema, []);
}

/** 写入实体索引（整体覆盖）。 */
async function writeEntities(workspacePaths: WorkspacePaths, bookId: string, entities: BookEntityRecord[]) {
  await writeJsonFile(createBookPaths(workspacePaths, bookId).entitiesIndexFile, entities);
}

/** 实体列表，可按实体类型过滤。 */
export async function listEntities(workspacePaths: WorkspacePaths, bookId: string, entityType?: EntityType) {
  const entities = await readEntities(workspacePaths, bookId);
  return entityType ? entities.filter((entity) => entity.entityType === entityType) : entities;
}

/** 捕获当前实体存储快照（索引 + 各实体 Markdown 内容），供 AI 初始化失败时恢复。 */
export async function captureEntityStorageSnapshot(
  workspacePaths: WorkspacePaths,
  bookId: string
): Promise<EntityStorageSnapshot> {
  const entities = await readEntities(workspacePaths, bookId);
  const files = await Promise.all(entities.map(async (entity) => {
    const filePath = entityMarkdownPath(workspacePaths, bookId, entity.entityType, entity.id);
    return {
      id: entity.id,
      entityType: entity.entityType,
      content: await pathExists(filePath) ? await readTextFile(filePath) : null
    };
  }));
  return { entities, files };
}

/**
 * 恢复实体存储快照：删除快照后新建的实体文件，按快照内容原样恢复，
 * 快照中内容为 null 的文件删除、否则写回原内容，最后恢复索引。
 */
export async function restoreEntityStorageSnapshot(
  workspacePaths: WorkspacePaths,
  bookId: string,
  snapshot: EntityStorageSnapshot,
  generated: GeneratedEntityInput[]
) {
  const originalKeys = new Set(snapshot.files.map((file) => `${file.entityType}:${file.id}`));
  await Promise.all(generated.map(async (entity) => {
    const key = `${entity.entityType}:${entity.id}`;
    if (!originalKeys.has(key)) {
      await rm(entityMarkdownPath(workspacePaths, bookId, entity.entityType, entity.id), { force: true });
    }
  }));
  await Promise.all(snapshot.files.map(async (file) => {
    const filePath = entityMarkdownPath(workspacePaths, bookId, file.entityType, file.id);
    if (file.content === null) {
      await rm(filePath, { force: true });
    } else {
      await writeTextFileAtomic(filePath, file.content);
    }
  }));
  await writeEntities(workspacePaths, bookId, snapshot.entities);
}

/** 按 ID 读取实体，不存在则抛 notFound。 */
export async function getEntity(workspacePaths: WorkspacePaths, bookId: string, entityId: string) {
  const entities = await readEntities(workspacePaths, bookId);
  const entity = entities.find((item) => item.id === entityId);

  if (!entity) {
    throw notFound("实体不存在", { bookId, entityId });
  }

  return entity;
}

/** 新建或更新实体：带 id 且已存在则更新（保留 createdAt），否则新建；同时写 Markdown 文件。 */
export async function saveEntity(workspacePaths: WorkspacePaths, bookId: string, body: unknown) {
  const input = entityUpsertInputSchema.parse(body);
  const entities = await readEntities(workspacePaths, bookId);
  const now = new Date().toISOString();
  const existing = input.id ? entities.find((entity) => entity.id === input.id) : null;
  const id = existing?.id ?? input.id ?? randomUUID();
  const fileName = `${id}.md`;
  const filePath = `entities/${input.entityType}s/${fileName}`;

  const mergedAttributes = { ...(existing?.attributes ?? {}), ...input.attributes };
  const entity: BookEntityRecord = {
    id,
    bookId,
    entityType: input.entityType,
    name: input.name,
    role: input.role,
    description: input.description,
    fileId: existing?.fileId ?? `entity-${id}`,
    attributes: input.entityType === "character"
      ? {
          ...mergedAttributes,
          profile: normalizeCharacterProfile(mergedAttributes, {
            description: input.description,
            state: existing && existing.entityType === "character"
              ? readCharacterProfile(existing)?.timeline.currentState
              : undefined
          })
        }
      : mergedAttributes,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  const nextEntities = existing
    ? entities.map((item) => (item.id === id ? entity : item))
    : [entity, ...entities];

  await writeEntities(workspacePaths, bookId, nextEntities);
  await writeTextFileAtomic(
    resolveInsideRoot(getEntityDir(workspacePaths, bookId, input.entityType), fileName),
    createEntityMarkdown(entity)
  );

  return {
    ...entity,
    path: filePath
  };
}

/** Replaces only entities owned by the initialization pipeline and preserves user-created entities. */
/**
 * 替换 AI 初始化流水线产生的实体。
 * 只替换 generatedBy=book-initialization 的旧实体并清理其文件；用户实体一律保留，
 * 若生成的实体与用户实体 ID 冲突则整体中止（拒绝覆盖）。
 */
export async function replaceGeneratedEntities(
  workspacePaths: WorkspacePaths,
  bookId: string,
  generated: GeneratedEntityInput[]
) {
  const existing = await readEntities(workspacePaths, bookId);
  const retained = existing.filter((entity) => entity.attributes.generatedBy !== "book-initialization");
  const retainedIds = new Set(retained.map((entity) => entity.id));
  const conflicting = generated.find((entity) => retainedIds.has(entity.id));
  if (conflicting) {
    throw conflict("AI 生成实体与用户实体 ID 冲突，已停止覆盖", {
      bookId,
      entityId: conflicting.id
    });
  }
  const now = new Date().toISOString();
  const nextGenerated: BookEntityRecord[] = generated.map((input) => {
    const previous = existing.find((entity) => entity.id === input.id);
    return {
      id: input.id,
      bookId,
      entityType: input.entityType,
      name: input.name,
      role: input.role,
      description: input.description,
      fileId: previous?.fileId ?? `entity-${input.id}`,
      attributes: { ...input.attributes, generatedBy: "book-initialization" },
      createdAt: previous?.createdAt ?? now,
      updatedAt: now
    };
  });

  await Promise.all(nextGenerated.map((entity) => writeTextFileAtomic(
    entityMarkdownPath(workspacePaths, bookId, entity.entityType, entity.id),
    createEntityMarkdown(entity)
  )));
  await writeEntities(workspacePaths, bookId, [...retained, ...nextGenerated]);
  const nextKeys = new Set(nextGenerated.map((entity) => `${entity.entityType}:${entity.id}`));
  await Promise.all(existing
    .filter((entity) => entity.attributes.generatedBy === "book-initialization")
    .filter((entity) => !nextKeys.has(`${entity.entityType}:${entity.id}`))
    .map((entity) => rm(entityMarkdownPath(workspacePaths, bookId, entity.entityType, entity.id), { force: true })));
  return nextGenerated;
}

/** 删除实体（索引中移除，文件保留由调用方决定）；不存在则抛 notFound。 */
export async function deleteEntity(workspacePaths: WorkspacePaths, bookId: string, entityId: string) {
  const entities = await readEntities(workspacePaths, bookId);
  const nextEntities = entities.filter((entity) => entity.id !== entityId);

  if (entities.length === nextEntities.length) {
    throw notFound("实体不存在", { bookId, entityId });
  }

  await writeEntities(workspacePaths, bookId, nextEntities);
  return { id: entityId };
}
