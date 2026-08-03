/**
 * 技能仓储。
 * 职责：维护技能索引（skill-index.v1）与 SKILL.md 指令文件；内置技能随定义自愈安装/升级（内容哈希变更即升版本），自定义技能落盘 custom 目录；
 * 边界：索引写操作不做锁（技能变更低频）；内置技能文件与索引内容哈希不一致时自动重写，保证技能内容可审计。
 */
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

/** SKILL.md 路径：内置/自定义分目录存放，防止互相覆盖。 */
function instructionPath(paths: WorkspacePaths, metadata: NovelSkillMetadata) {
  const bucket = metadata.source === "builtin" ? "builtin" : "custom";
  return resolveInsideRoot(paths.skillsDir, bucket, metadata.id, "SKILL.md");
}

/** 由内置定义构造元数据：instructionHash 用于内容校验与升级判定。 */
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

  /**
   * 安装/自愈内置技能：缺技能则新增；内容哈希变更视为定义升级（version+1，保留 enabled 状态）；
   * SKILL.md 缺失或与哈希不一致时重写。工作区启动时调用。
   */
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
        // 定义升级：版本 +1，保留用户的启用状态与创建时间
        items[items.indexOf(existing)] = {
          ...metadata,
          version: existing.version + 1,
          enabled: existing.enabled,
          createdAt: existing.createdAt
        };
        changed = true;
      }
      // 指令文件自愈：缺失或内容与定义不符时按定义重写
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

  /** 列出全部技能（先自愈安装）。 */
  async list() {
    return this.ensureInstalled();
  }

  /** 读取技能详情；指令文件与元数据哈希不一致视为文件损坏，直接抛错。 */
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

  /** 创建自定义技能：id 唯一性校验 + 指令文本写入 + 索引登记，返回详情。 */
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

  /** 启停技能：仅改索引中的 enabled 字段。 */
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

/** 读取指令文件；不存在时返回 null（调用方按缺失处理）。 */
async function readInstructionsIfPresent(file: string) {
  if (!(await pathExists(file))) return null;
  return (await readTextFile(file)).trim();
}
