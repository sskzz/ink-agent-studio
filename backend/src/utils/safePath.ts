import path from "node:path";
import { badRequest } from "./errors.js";

/**
 * 安全解析工作区内路径。
 * 所有用户传入的文件名、fileId、相对路径都必须走这里，防止 `../` 路径穿越写到项目外部。
 */
export function resolveInsideRoot(root: string, ...segments: string[]) {
  const rootPath = path.resolve(root);
  const resolvedPath = path.resolve(rootPath, ...segments);
  const isRoot = resolvedPath === rootPath;
  const isInsideRoot = resolvedPath.startsWith(`${rootPath}${path.sep}`);

  if (!isRoot && !isInsideRoot) {
    throw badRequest("非法文件路径，目标路径超出工作区", {
      root: rootPath,
      target: resolvedPath
    });
  }

  return resolvedPath;
}

/**
 * 把 Windows 路径统一转成前端和 JSON 更容易处理的斜杠路径。
 */
export function toPortablePath(filePath: string) {
  return filePath.split(path.sep).join("/");
}
