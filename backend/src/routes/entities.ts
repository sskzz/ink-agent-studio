import { Hono } from "hono";
import { deleteEntity, getEntity, listEntities, saveEntity } from "../modules/books/entityService.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { entityTypeSchema } from "../schemas/entitySchemas.js";
import { jsonOk } from "../utils/http.js";

/**
 * 实体路由。
 * 提供实体（人物/阵营/地点/物品）的 CRUD；type 查询参数可过滤实体类型。
 */
export const entitiesRoute = new Hono();

/** 使用默认工作区路径。 */
function paths() {
  return createWorkspacePaths();
}

/**
 * GET /api/v1/books/:bookId/entities：实体列表。
 * type 参数非法（不在枚举内）→ 400。
 */
entitiesRoute.get("/books/:bookId/entities", async (context) => {
  const typeQuery = context.req.query("type");
  const entityType = typeQuery ? entityTypeSchema.parse(typeQuery) : undefined;
  const entities = await listEntities(paths(), context.req.param("bookId"), entityType);
  return jsonOk(context, entities);
});

/**
 * POST /api/v1/books/:bookId/entities：新建实体，名称必填（校验失败 → 400）。
 */
entitiesRoute.post("/books/:bookId/entities", async (context) => {
  const entity = await saveEntity(paths(), context.req.param("bookId"), await context.req.json());
  return jsonOk(context, entity, "实体已保存", 201);
});

/**
 * GET /api/v1/books/:bookId/entities/:entityId：实体详情。不存在 → 404。
 */
entitiesRoute.get("/books/:bookId/entities/:entityId", async (context) => {
  const entity = await getEntity(paths(), context.req.param("bookId"), context.req.param("entityId"));
  return jsonOk(context, entity);
});

/**
 * PATCH /api/v1/books/:bookId/entities/:entityId：更新实体（路径 id 覆盖 body id）。
 */
entitiesRoute.patch("/books/:bookId/entities/:entityId", async (context) => {
  const entity = await saveEntity(paths(), context.req.param("bookId"), {
    ...(await context.req.json()),
    id: context.req.param("entityId")
  });
  return jsonOk(context, entity, "实体已更新");
});

/**
 * DELETE /api/v1/books/:bookId/entities/:entityId：删除实体。不存在 → 404。
 */
entitiesRoute.delete("/books/:bookId/entities/:entityId", async (context) => {
  const deleted = await deleteEntity(paths(), context.req.param("bookId"), context.req.param("entityId"));
  return jsonOk(context, deleted, "实体已删除");
});
