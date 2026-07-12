import { Hono } from "hono";
import {
  getBookFileContent,
  listBookFiles,
  updateBookFileContent,
  uploadBookFile
} from "../modules/files/fileService.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { jsonOk } from "../utils/http.js";

export const filesRoute = new Hono();

function paths() {
  return createWorkspacePaths();
}

filesRoute.get("/books/:bookId/files", async (context) => {
  const files = await listBookFiles(paths(), context.req.param("bookId"));
  return jsonOk(context, files);
});

filesRoute.get("/books/:bookId/files/:fileId", async (context) => {
  const file = await getBookFileContent(paths(), context.req.param("bookId"), context.req.param("fileId"));
  return jsonOk(context, file);
});

filesRoute.put("/books/:bookId/files/:fileId", async (context) => {
  const file = await updateBookFileContent(
    paths(),
    context.req.param("bookId"),
    context.req.param("fileId"),
    await context.req.json()
  );
  return jsonOk(context, file, "文件已保存");
});

filesRoute.post("/books/:bookId/files/upload", async (context) => {
  const file = await uploadBookFile(paths(), context.req.param("bookId"), await context.req.json());
  return jsonOk(context, file, "文件已上传", 201);
});
