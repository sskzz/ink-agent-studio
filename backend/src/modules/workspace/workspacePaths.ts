/**
 * 文件职责：计算本地工作区的全部路径（配置、索引、密钥、作品、风格、技能、备份、日志）。
 * 边界：只做路径计算与安全校验，不创建目录、不读写文件。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveInsideRoot } from "../../utils/safePath.js";

/** 工作区路径集合：所有子路径都通过 resolveInsideRoot 生成，防止越出工作区根目录。 */
export interface WorkspacePaths {
  root: string;
  configDir: string;
  indexDir: string;
  secretsDir: string;
  booksDir: string;
  stylesDir: string;
  skillsDir: string;
  backupsDir: string;
  logsDir: string;
  appConfigFile: string;
  runtimeDatabaseFile: string;
  workspaceLockFile: string;
  booksIndexFile: string;
  modelConfigsFile: string;
  modelRoutesFile: string;
  writingStylesFile: string;
  runsLogFile: string;
  modelSecretsFile: string;
  skillsIndexFile: string;
}

/** 默认工作区根目录：项目根下的 data/workspaces/default（相对本文件位置推导，便于安装后直接运行）。 */
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
  const configDir = resolveInsideRoot(workspaceRoot, "config");
  const indexDir = resolveInsideRoot(workspaceRoot, "index");
  const secretsDir = resolveInsideRoot(workspaceRoot, "secrets");
  const booksDir = resolveInsideRoot(workspaceRoot, "books");
  const stylesDir = resolveInsideRoot(workspaceRoot, "styles");
  const skillsDir = resolveInsideRoot(workspaceRoot, "skills");
  const backupsDir = resolveInsideRoot(workspaceRoot, "backups");
  const logsDir = resolveInsideRoot(workspaceRoot, "logs");

  return {
    root: workspaceRoot,
    configDir,
    indexDir,
    secretsDir,
    booksDir,
    stylesDir,
    skillsDir,
    backupsDir,
    logsDir,
    appConfigFile: resolveInsideRoot(configDir, "app-config.json"),
    runtimeDatabaseFile: resolveInsideRoot(indexDir, "runtime.sqlite"),
    workspaceLockFile: resolveInsideRoot(indexDir, "workspace.lock"),
    booksIndexFile: resolveInsideRoot(indexDir, "books.json"),
    modelConfigsFile: resolveInsideRoot(indexDir, "model-configs.json"),
    modelRoutesFile: resolveInsideRoot(indexDir, "model-routes.json"),
    writingStylesFile: resolveInsideRoot(indexDir, "writing-styles.json"),
    runsLogFile: resolveInsideRoot(indexDir, "runs.jsonl"),
    modelSecretsFile: resolveInsideRoot(secretsDir, "model-secrets.json"),
    skillsIndexFile: resolveInsideRoot(skillsDir, "index.json")
  };
}
