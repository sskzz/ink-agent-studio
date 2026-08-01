import path from "node:path";
import { resolveInsideRoot } from "../../utils/safePath.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";

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
