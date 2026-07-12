import { Hono } from "hono";
import { deleteEntity, getEntity, listEntities, saveEntity } from "../modules/books/entityService.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { entityTypeSchema } from "../schemas/entitySchemas.js";
import { jsonOk } from "../utils/http.js";

export const entitiesRoute = new Hono();

function paths() {
  return createWorkspacePaths();
}

entitiesRoute.get("/books/:bookId/entities", async (context) => {
  const typeQuery = context.req.query("type");
  const entityType = typeQuery ? entityTypeSchema.parse(typeQuery) : undefined;
  const entities = await listEntities(paths(), context.req.param("bookId"), entityType);
  return jsonOk(context, entities);
});

entitiesRoute.post("/books/:bookId/entities", async (context) => {
  const entity = await saveEntity(paths(), context.req.param("bookId"), await context.req.json());
  return jsonOk(context, entity, "实体已保存", 201);
});

entitiesRoute.get("/books/:bookId/entities/:entityId", async (context) => {
  const entity = await getEntity(paths(), context.req.param("bookId"), context.req.param("entityId"));
  return jsonOk(context, entity);
});

entitiesRoute.patch("/books/:bookId/entities/:entityId", async (context) => {
  const entity = await saveEntity(paths(), context.req.param("bookId"), {
    ...(await context.req.json()),
    id: context.req.param("entityId")
  });
  return jsonOk(context, entity, "实体已更新");
});

entitiesRoute.delete("/books/:bookId/entities/:entityId", async (context) => {
  const deleted = await deleteEntity(paths(), context.req.param("bookId"), context.req.param("entityId"));
  return jsonOk(context, deleted, "实体已删除");
});
