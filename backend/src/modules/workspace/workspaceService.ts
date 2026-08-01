import { z } from "zod";
import { ensureDirectory, pathExists, writeTextFileAtomic } from "../../utils/fileStore.js";
import { readJsonFile, writeJsonFile } from "../../utils/jsonStore.js";
import type { WorkspacePaths } from "./workspacePaths.js";
import { migrateWritingStyleStorage } from "../styles/writingStyleMigration.js";
import { SkillRepository } from "../skills/skillRepository.js";

const emptyArraySchema = z.array(z.unknown());
const modelRoutesSchema = z.object({
  writingModelId: z.string().nullable(),
  reviewModelId: z.string().nullable(),
  planningModelId: z.string().nullable()
});
const modelSecretsSchema = z.record(z.string(), z.string());

const defaultRoutes = {
  writingModelId: null,
  reviewModelId: null,
  planningModelId: null
};

/**
 * 初始化本地工作区。
 * 这是后端启动时最先执行的步骤，确保 JSON 索引、密钥目录和作品目录都存在。
 */
export async function ensureWorkspace(paths: WorkspacePaths) {
  await Promise.all([
    ensureDirectory(paths.configDir),
    ensureDirectory(paths.indexDir),
    ensureDirectory(paths.secretsDir),
    ensureDirectory(paths.booksDir),
    ensureDirectory(paths.stylesDir),
    ensureDirectory(paths.skillsDir),
    ensureDirectory(paths.backupsDir),
    ensureDirectory(paths.logsDir)
  ]);

  await Promise.all([
    readJsonFile(paths.booksIndexFile, emptyArraySchema, []),
    readJsonFile(paths.modelConfigsFile, emptyArraySchema, []),
    readJsonFile(paths.modelRoutesFile, modelRoutesSchema, defaultRoutes),
    readJsonFile(paths.writingStylesFile, emptyArraySchema, []),
    readJsonFile(paths.modelSecretsFile, modelSecretsSchema, {})
  ]);

  if (!(await pathExists(paths.runsLogFile))) {
    await writeTextFileAtomic(paths.runsLogFile, "");
  }

  await migrateWritingStyleStorage(paths);
  await new SkillRepository(paths).ensureInstalled();
}

export async function getWorkspaceSummary(paths: WorkspacePaths) {
  await ensureWorkspace(paths);
  const books = await readJsonFile(paths.booksIndexFile, emptyArraySchema, []);
  const modelConfigs = await readJsonFile(paths.modelConfigsFile, emptyArraySchema, []);
  const writingStyles = await readJsonFile(paths.writingStylesFile, emptyArraySchema, []);
  const routes = await readJsonFile(paths.modelRoutesFile, modelRoutesSchema, defaultRoutes);

  return {
    root: paths.root,
    indexDir: paths.indexDir,
    booksDir: paths.booksDir,
    booksCount: books.length,
    modelConfigsCount: modelConfigs.length,
    writingStylesCount: writingStyles.length,
    routes
  };
}

/**
 * 测试或修复工具可调用此方法重置模型路由。
 * 业务接口不要直接覆盖配置文件，应通过 models 模块做校验后再写入。
 */
export async function resetModelRoutes(paths: WorkspacePaths) {
  await writeJsonFile(paths.modelRoutesFile, defaultRoutes);
  return defaultRoutes;
}
