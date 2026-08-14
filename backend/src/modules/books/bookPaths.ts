/**
 * 文件职责：定义单本作品在本地工作区内的全部路径。
 * 边界：只负责路径计算（含安全校验），不读写任何文件。
 */
import { resolveInsideRoot } from "../../utils/safePath.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";

/** 单本作品的全部本地路径：根目录、JSON 索引、Markdown 文件与各实体目录。 */
export interface BookPaths {
  bookDir: string;
  bookFile: string;
  filesIndexFile: string;
  entitiesIndexFile: string;
  chaptersIndexFile: string;
  briefFile: string;
  outlineFile: string;
  worldFile: string;
  currentStateFile: string;
  foreshadowingFile: string;
  runtimeStateFile: string;
  /** 三层大纲的结构化权威源；outline.md 仅为人类可读投影。 */
  storyPlanFile: string;
  /** 世界规则与剧情演进提案的结构化权威源；world.md 仅为人类可读投影。 */
  worldRulesFile: string;
  /** 旧作品知识回填提案；独立于权威知识文件，应用前可重复审阅。 */
  legacyKnowledgeBackfillFile: string;
  /** 知识变更前快照目录；用于回填应用和后续人工知识变更审计。 */
  knowledgeSnapshotsDir: string;
  /** 语义知识疑点的人工确认/豁免记录。 */
  knowledgeAuditDecisionsFile: string;
  authorIntentFile: string;
  currentFocusFile: string;
  chaptersDir: string;
  charactersDir: string;
  factionsDir: string;
  locationsDir: string;
  itemsDir: string;
  runsDir: string;
  importsDir: string;
}

/**
 * 单本作品的所有本地路径。
 * 业务代码不得自己拼路径，统一走这里可以避免目录结构失控和路径穿越风险。
 */
export function createBookPaths(workspacePaths: WorkspacePaths, bookId: string): BookPaths {
  const bookDir = resolveInsideRoot(workspacePaths.booksDir, bookId);
  const entitiesDir = resolveInsideRoot(bookDir, "entities");
  const stateDir = resolveInsideRoot(bookDir, "state");

  return {
    bookDir,
    bookFile: resolveInsideRoot(bookDir, "book.json"),
    filesIndexFile: resolveInsideRoot(bookDir, "files.json"),
    entitiesIndexFile: resolveInsideRoot(bookDir, "entities.json"),
    chaptersIndexFile: resolveInsideRoot(bookDir, "chapters.json"),
    briefFile: resolveInsideRoot(bookDir, "brief.md"),
    outlineFile: resolveInsideRoot(bookDir, "outline.md"),
    worldFile: resolveInsideRoot(bookDir, "world.md"),
    currentStateFile: resolveInsideRoot(stateDir, "current.md"),
    foreshadowingFile: resolveInsideRoot(stateDir, "foreshadowing.md"),
    runtimeStateFile: resolveInsideRoot(stateDir, "runtime.json"),
    storyPlanFile: resolveInsideRoot(stateDir, "story-plan.json"),
    worldRulesFile: resolveInsideRoot(stateDir, "world-rules.json"),
    legacyKnowledgeBackfillFile: resolveInsideRoot(stateDir, "legacy-knowledge-backfill.json"),
    knowledgeSnapshotsDir: resolveInsideRoot(stateDir, "knowledge-snapshots"),
    knowledgeAuditDecisionsFile: resolveInsideRoot(stateDir, "knowledge-audit-decisions.json"),
    authorIntentFile: resolveInsideRoot(stateDir, "author_intent.md"),
    currentFocusFile: resolveInsideRoot(stateDir, "current_focus.md"),
    chaptersDir: resolveInsideRoot(bookDir, "chapters"),
    charactersDir: resolveInsideRoot(entitiesDir, "characters"),
    factionsDir: resolveInsideRoot(entitiesDir, "factions"),
    locationsDir: resolveInsideRoot(entitiesDir, "locations"),
    itemsDir: resolveInsideRoot(entitiesDir, "items"),
    runsDir: resolveInsideRoot(bookDir, "runs"),
    importsDir: resolveInsideRoot(bookDir, "imports")
  };
}
