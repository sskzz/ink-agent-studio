import {
  knowledgeAuditDecisionRegistrySchema,
  type KnowledgeAuditDecisionRegistry
} from "../../schemas/storyKnowledgeSchemas.js";
import { pathExists } from "../../utils/fileStore.js";
import { readJsonFile, writeJsonFile } from "../../utils/jsonStore.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { getBook } from "./bookRepository.js";
import { createBookPaths } from "./bookPaths.js";

export async function readKnowledgeAuditDecisions(paths: WorkspacePaths, bookId: string): Promise<KnowledgeAuditDecisionRegistry> {
  await getBook(paths, bookId);
  const filePath = createBookPaths(paths, bookId).knowledgeAuditDecisionsFile;
  if (!(await pathExists(filePath))) {
    return { schemaVersion: "knowledge-audit-decisions.v1", bookId, decisions: [], updatedAt: new Date(0).toISOString() };
  }
  return readJsonFile(filePath, knowledgeAuditDecisionRegistrySchema, null as never);
}

export async function upsertKnowledgeAuditDecision(
  paths: WorkspacePaths,
  bookId: string,
  input: { fingerprint: string; decision: "confirmed" | "exempted"; reason: string; issueCode: string; sourceId: string }
) {
  const registry = await readKnowledgeAuditDecisions(paths, bookId);
  const now = new Date().toISOString();
  const existing = registry.decisions.find((item) => item.fingerprint === input.fingerprint);
  const decision = {
    ...input,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  const next = knowledgeAuditDecisionRegistrySchema.parse({
    ...registry,
    decisions: existing
      ? registry.decisions.map((item) => item.fingerprint === input.fingerprint ? decision : item)
      : [...registry.decisions, decision],
    updatedAt: now
  });
  await writeJsonFile(createBookPaths(paths, bookId).knowledgeAuditDecisionsFile, next);
  return next;
}
