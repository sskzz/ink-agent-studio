/**
 * 写作风格路径集合。
 * 职责：集中计算一个风格在磁盘上的全部路径（样本/版本/编译缓存/索引/详情），供仓储层使用；
 * 边界：所有路径都经 resolveInsideRoot 约束在工作区根内，防止风格 id 拼接出的路径越界。
 */
import path from "node:path";
import { resolveInsideRoot } from "../../utils/safePath.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";

/** 按风格 id 生成目录与文件路径集合；contentHash/版本 id 等子路径同样在根内约束。 */
export function createWritingStylePaths(workspacePaths: WorkspacePaths, styleId: string) {
  const styleDir = resolveInsideRoot(workspacePaths.stylesDir, styleId);
  const samplesDir = resolveInsideRoot(styleDir, "samples");
  const versionsDir = resolveInsideRoot(styleDir, "versions");
  const compiledDir = resolveInsideRoot(styleDir, "compiled");
  return {
    styleDir,
    samplesDir,
    versionsDir,
    compiledDir,
    styleFile: resolveInsideRoot(styleDir, "style.json"),
    samplesIndexFile: resolveInsideRoot(samplesDir, "index.json"),
    versionsIndexFile: resolveInsideRoot(versionsDir, "index.json"),
    sampleContentFile: (sampleId: string) => resolveInsideRoot(samplesDir, `${sampleId}.txt`),
    sampleMetadataFile: (sampleId: string) => resolveInsideRoot(samplesDir, `${sampleId}.json`),
    versionFile: (versionId: string) => resolveInsideRoot(versionsDir, `${versionId}.json`),
    compiledFile: (constraintHash: string) => resolveInsideRoot(compiledDir, `${constraintHash}.json`),
    relativeSamplePath: (sampleId: string) => path.posix.join("samples", `${sampleId}.txt`)
  };
}
