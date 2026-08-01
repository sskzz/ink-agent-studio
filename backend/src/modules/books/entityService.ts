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

function createEntityMarkdown(entity: BookEntityRecord) {
  return `# ${entity.name}

## 类型
${entity.entityType}

## 定位
${entity.role || "待补充"}

## 描述
${entity.description || "待补充"}
`;
}

export interface GeneratedEntityInput {
  id: string;
  entityType: EntityType;
  name: string;
  role: string;
  description: string;
  attributes: Record<string, unknown>;
}

export interface EntityStorageSnapshot {
  entities: BookEntityRecord[];
  files: Array<{
    id: string;
    entityType: EntityType;
    content: string | null;
  }>;
}

function entityMarkdownPath(workspacePaths: WorkspacePaths, bookId: string, entityType: EntityType, entityId: string) {
  return resolveInsideRoot(getEntityDir(workspacePaths, bookId, entityType), `${entityId}.md`);
}

async function readEntities(workspacePaths: WorkspacePaths, bookId: string) {
  await getBook(workspacePaths, bookId);
  return readJsonFile(createBookPaths(workspacePaths, bookId).entitiesIndexFile, bookEntitiesIndexSchema, []);
}

async function writeEntities(workspacePaths: WorkspacePaths, bookId: string, entities: BookEntityRecord[]) {
  await writeJsonFile(createBookPaths(workspacePaths, bookId).entitiesIndexFile, entities);
}

export async function listEntities(workspacePaths: WorkspacePaths, bookId: string, entityType?: EntityType) {
  const entities = await readEntities(workspacePaths, bookId);
  return entityType ? entities.filter((entity) => entity.entityType === entityType) : entities;
}

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

export async function getEntity(workspacePaths: WorkspacePaths, bookId: string, entityId: string) {
  const entities = await readEntities(workspacePaths, bookId);
  const entity = entities.find((item) => item.id === entityId);

  if (!entity) {
    throw notFound("实体不存在", { bookId, entityId });
  }

  return entity;
}

export async function saveEntity(workspacePaths: WorkspacePaths, bookId: string, body: unknown) {
  const input = entityUpsertInputSchema.parse(body);
  const entities = await readEntities(workspacePaths, bookId);
  const now = new Date().toISOString();
  const existing = input.id ? entities.find((entity) => entity.id === input.id) : null;
  const id = existing?.id ?? input.id ?? randomUUID();
  const fileName = `${id}.md`;
  const filePath = `entities/${input.entityType}s/${fileName}`;

  const entity: BookEntityRecord = {
    id,
    bookId,
    entityType: input.entityType,
    name: input.name,
    role: input.role,
    description: input.description,
    fileId: existing?.fileId ?? `entity-${id}`,
    attributes: input.attributes,
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

export async function deleteEntity(workspacePaths: WorkspacePaths, bookId: string, entityId: string) {
  const entities = await readEntities(workspacePaths, bookId);
  const nextEntities = entities.filter((entity) => entity.id !== entityId);

  if (entities.length === nextEntities.length) {
    throw notFound("实体不存在", { bookId, entityId });
  }

  await writeEntities(workspacePaths, bookId, nextEntities);
  return { id: entityId };
}
