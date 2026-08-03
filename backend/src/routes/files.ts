import { Hono } from "hono";
import {
  getBookFileContent,
  listBookFiles,
  updateBookFileContent,
  uploadBookFile
} from "../modules/files/fileService.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { jsonOk } from "../utils/http.js";

/**
 * 作品文件路由。
 * 提供文件列表、内容读取、内容更新与上传（导入）接口。
 */
export const filesRoute = new Hono();

/** 使用默认工作区路径。 */
function paths() {
  return createWorkspacePaths();
}

/**
 * GET /api/v1/books/:bookId/files：文件列表（元信息，不含正文）。作品不存在 → 404。
 */
filesRoute.get("/books/:bookId/files", async (context) => {
  const files = await listBookFiles(paths(), context.req.param("bookId"));
  return jsonOk(context, files);
});

/**
 * GET /api/v1/books/:bookId/files/:fileId：文件详情（含正文）。不存在 → 404。
 */
filesRoute.get("/books/:bookId/files/:fileId", async (context) => {
  const file = await getBookFileContent(paths(), context.req.param("bookId"), context.req.param("fileId"));
  return jsonOk(context, file);
});

/**
 * PUT /api/v1/books/:bookId/files/:fileId：全量更新文件内容（body 校验失败 → 400）。
 */
filesRoute.put("/books/:bookId/files/:fileId", async (context) => {
  const file = await updateBookFileContent(
    paths(),
    context.req.param("bookId"),
    context.req.param("fileId"),
    await context.req.json()
  );
  return jsonOk(context, file, "文件已保存");
});

/**
 * POST /api/v1/books/:bookId/files/upload：上传文件（fileName/content 必填，校验失败 → 400）。
 */
filesRoute.post("/books/:bookId/files/upload", async (context) => {
  const file = await uploadBookFile(paths(), context.req.param("bookId"), await context.req.json());
  return jsonOk(context, file, "文件已上传", 201);
});
