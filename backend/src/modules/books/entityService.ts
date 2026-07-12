import { randomUUID } from "node:crypto";
import { bookEntitiesIndexSchema, entityUpsertInputSchema } from "../../schemas/entitySchemas.js";
import type { BookEntityRecord, EntityType } from "../../types/domain.js";
import { notFound } from "../../utils/errors.js";
import { writeTextFileAtomic } from "../../utils/fileStore.js";
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

export async function deleteEntity(workspacePaths: WorkspacePaths, bookId: string, entityId: string) {
  const entities = await readEntities(workspacePaths, bookId);
  const nextEntities = entities.filter((entity) => entity.id !== entityId);

  if (entities.length === nextEntities.length) {
    throw notFound("实体不存在", { bookId, entityId });
  }

  await writeEntities(workspacePaths, bookId, nextEntities);
  return { id: entityId };
}
