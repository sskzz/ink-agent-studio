import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveInsideRoot } from "../../utils/safePath.js";

export interface WorkspacePaths {
  root: string;
  indexDir: string;
  secretsDir: string;
  booksDir: string;
  booksIndexFile: string;
  modelConfigsFile: string;
  modelRoutesFile: string;
  writingStylesFile: string;
  runsLogFile: string;
  modelSecretsFile: string;
}

function getDefaultWorkspaceRoot() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const backendRoot = path.resolve(currentDir, "../../..");
  const projectRoot = path.resolve(backendRoot, "..");
  return path.join(projectRoot, "data", "workspaces", "default");
}

/**
 * 生成工作区路径集合。
 * 环境变量 INK_AGENT_DATA_DIR 可覆盖默认目录，方便用户把数据放到 D 盘指定位置。
 */
export function createWorkspacePaths(root = process.env.INK_AGENT_DATA_DIR ?? getDefaultWorkspaceRoot()): WorkspacePaths {
  const workspaceRoot = path.resolve(root);
  const indexDir = resolveInsideRoot(workspaceRoot, "index");
  const secretsDir = resolveInsideRoot(workspaceRoot, "secrets");
  const booksDir = resolveInsideRoot(workspaceRoot, "books");

  return {
    root: workspaceRoot,
    indexDir,
    secretsDir,
    booksDir,
    booksIndexFile: resolveInsideRoot(indexDir, "books.json"),
    modelConfigsFile: resolveInsideRoot(indexDir, "model-configs.json"),
    modelRoutesFile: resolveInsideRoot(indexDir, "model-routes.json"),
    writingStylesFile: resolveInsideRoot(indexDir, "writing-styles.json"),
    runsLogFile: resolveInsideRoot(indexDir, "runs.jsonl"),
    modelSecretsFile: resolveInsideRoot(secretsDir, "model-secrets.json")
  };
}
