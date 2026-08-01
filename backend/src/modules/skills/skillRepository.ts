import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  novelSkillDetailSchema,
  novelSkillMetadataSchema,
  type NovelSkillDetail,
  type NovelSkillMetadata
} from "@ink-agent/contracts";
import { estimateTokens } from "../prompts/promptAssembler.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { readJsonFile, writeJsonFile } from "../../utils/jsonStore.js";
import { pathExists, readTextFile, writeTextFileAtomic } from "../../utils/fileStore.js";
import { resolveInsideRoot } from "../../utils/safePath.js";
import { sha256 } from "../../utils/hash.js";
import { conflict, notFound } from "../../utils/errors.js";
import { builtinSkillDefinitions } from "./skillDefinitions.js";
import { z } from "zod";

const skillIndexSchema = z.object({
  schemaVersion: z.literal("skill-index.v1"),
  items: z.array(novelSkillMetadataSchema)
}).strict();

function instructionPath(paths: WorkspacePaths, metadata: NovelSkillMetadata) {
  const bucket = metadata.source === "builtin" ? "builtin" : "custom";
  return resolveInsideRoot(paths.skillsDir, bucket, metadata.id, "SKILL.md");
}

function metadataForBuiltin(id: string, now: string): NovelSkillMetadata {
  const definition = builtinSkillDefinitions.find((item) => item.id === id);
  if (!definition) throw new Error(`内置技能不存在：${id}`);
  return {
    schemaVersion: "novel-skill.v1",
    id: definition.id,
    name: definition.name,
    description: definition.description,
    version: 1,
    source: "builtin",
    enabled: true,
    appliesTo: definition.appliesTo,
    triggerTerms: definition.triggerTerms,
    priority: definition.priority,
    instructionHash: sha256(definition.instructions),
    instructionEstimatedTokens: estimateTokens(definition.instructions),
    createdAt: now,
    updatedAt: now
  };
}

export class SkillRepository {
  constructor(private readonly paths: WorkspacePaths) {}

  async ensureInstalled() {
    const now = new Date().toISOString();
    const current = await readJsonFile(this.paths.skillsIndexFile, skillIndexSchema, {
      schemaVersion: "skill-index.v1",
      items: []
    });
    const items = [...current.items];
    let changed = false;
    for (const definition of builtinSkillDefinitions) {
      const metadata = metadataForBuiltin(definition.id, now);
      const existing = items.find((item) => item.id === metadata.id);
      if (!existing) {
        items.push(metadata);
        changed = true;
      } else if (existing.source === "builtin" && existing.instructionHash !== metadata.instructionHash) {
        items[items.indexOf(existing)] = {
          ...metadata,
          version: existing.version + 1,
          enabled: existing.enabled,
          createdAt: existing.createdAt
        };
        changed = true;
      }
      const file = instructionPath(this.paths, metadata);
      const storedInstructions = await readInstructionsIfPresent(file);
      if (storedInstructions === null || sha256(storedInstructions) !== metadata.instructionHash) {
        await mkdir(path.dirname(file), { recursive: true });
        await writeTextFileAtomic(file, `${definition.instructions.trim()}\n`);
      }
    }
    if (changed || !(await pathExists(this.paths.skillsIndexFile))) {
      await writeJsonFile(this.paths.skillsIndexFile, { schemaVersion: "skill-index.v1", items });
    }
    return items;
  }

  async list() {
    return this.ensureInstalled();
  }

  async get(id: string): Promise<NovelSkillDetail> {
    const metadata = (await this.ensureInstalled()).find((item) => item.id === id);
    if (!metadata) throw notFound("技能不存在", { id });
    const instructions = await readTextFile(instructionPath(this.paths, metadata));
    const detail = novelSkillDetailSchema.parse({ metadata, instructions: instructions.trim() });
    if (sha256(detail.instructions) !== metadata.instructionHash) {
      throw new Error(`技能文件校验失败：${id}`);
    }
    return detail;
  }

  async create(input: {
    id: string;
    name: string;
    description: string;
    appliesTo: NovelSkillMetadata["appliesTo"];
    triggerTerms: string[];
    priority: number;
    instructions: string;
  }) {
    const items = await this.ensureInstalled();
    if (items.some((item) => item.id === input.id)) throw conflict("技能 ID 已存在", { id: input.id });
    const now = new Date().toISOString();
    const instructions = input.instructions.trim();
    const metadata = novelSkillMetadataSchema.parse({
      schemaVersion: "novel-skill.v1",
      id: input.id,
      name: input.name,
      description: input.description,
      appliesTo: input.appliesTo,
      triggerTerms: input.triggerTerms,
      priority: input.priority,
      version: 1,
      source: "custom",
      enabled: true,
      instructionHash: sha256(instructions),
      instructionEstimatedTokens: estimateTokens(instructions),
      createdAt: now,
      updatedAt: now
    });
    const file = instructionPath(this.paths, metadata);
    await mkdir(path.dirname(file), { recursive: true });
    await writeTextFileAtomic(file, `${instructions}\n`);
    await writeJsonFile(this.paths.skillsIndexFile, { schemaVersion: "skill-index.v1", items: [...items, metadata] });
    return { metadata, instructions } satisfies NovelSkillDetail;
  }

  async setEnabled(id: string, enabled: boolean) {
    const items = await this.ensureInstalled();
    const current = items.find((item) => item.id === id);
    if (!current) throw notFound("技能不存在", { id });
    const next = { ...current, enabled, updatedAt: new Date().toISOString() };
    await writeJsonFile(this.paths.skillsIndexFile, {
      schemaVersion: "skill-index.v1",
      items: items.map((item) => item.id === id ? next : item)
    });
    return next;
  }
}

async function readInstructionsIfPresent(file: string) {
  if (!(await pathExists(file))) return null;
  return (await readTextFile(file)).trim();
}
