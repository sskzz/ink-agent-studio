import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { readTextFile, writeTextFileAtomic } from "../utils/fileStore.js";
import { ConfigRepository } from "./configRepository.js";
import { ConfigService } from "./configService.js";
import { defaultAppConfig } from "./defaultAppConfig.js";

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

function createService(root: string) {
  const paths = createWorkspacePaths(root);
  return { paths, service: new ConfigService(new ConfigRepository(paths)) };
}

describe("ConfigService", () => {
  it("creates the versioned public config on first read", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-config-"));
    const { paths, service } = createService(tempRoot);

    const config = await service.initialize();

    expect(config).toEqual(defaultAppConfig);
    await expect(readTextFile(paths.appConfigFile)).resolves.toContain('"schemaVersion": "app-config.v1"');
  });

  it("updates with optimistic revision checks", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-config-"));
    const { service } = createService(tempRoot);
    await service.initialize();

    const updated = await service.update({
      expectedRevision: 1,
      changes: { runtime: { globalConcurrency: 3 } }
    });

    expect(updated.revision).toBe(2);
    expect(updated.effectiveConfig.runtime.globalConcurrency).toBe(3);
    await expect(service.update({
      expectedRevision: 1,
      changes: { runtime: { globalConcurrency: 4 } }
    })).rejects.toMatchObject({ status: 409 });
  });

  it("does not overwrite invalid JSON", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-config-"));
    const { paths, service } = createService(tempRoot);
    const invalid = "{ invalid json\n";
    await writeTextFileAtomic(paths.appConfigFile, invalid);

    await expect(service.initialize()).rejects.toThrow("不是合法 JSON");
    await expect(readTextFile(paths.appConfigFile)).resolves.toBe(invalid);
  });

  it("keeps the committed example equal to the code defaults", async () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const examplePath = path.resolve(currentDir, "../../config/app-config.example.json");
    const example = JSON.parse(await readFile(examplePath, "utf8"));

    expect(example).toEqual(defaultAppConfig);
  });
});
