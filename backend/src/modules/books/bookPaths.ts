import { resolveInsideRoot } from "../../utils/safePath.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";

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
    chaptersDir: resolveInsideRoot(bookDir, "chapters"),
    charactersDir: resolveInsideRoot(entitiesDir, "characters"),
    factionsDir: resolveInsideRoot(entitiesDir, "factions"),
    locationsDir: resolveInsideRoot(entitiesDir, "locations"),
    itemsDir: resolveInsideRoot(entitiesDir, "items"),
    runsDir: resolveInsideRoot(bookDir, "runs"),
    importsDir: resolveInsideRoot(bookDir, "imports")
  };
}
