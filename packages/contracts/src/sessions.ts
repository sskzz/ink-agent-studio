import { z } from "zod";
import { isoDateTimeSchema } from "./common.js";

export const sessionStatusSchema = z.enum(["active", "archived"]);
export const sessionMessageRoleSchema = z.enum(["system", "user", "assistant", "tool"]);

export const sessionSchema = z.object({
  schemaVersion: z.literal("session.v1"),
  id: z.string().min(1),
  bookId: z.string().nullable(),
  title: z.string(),
  status: sessionStatusSchema,
  parentSessionId: z.string().nullable(),
  lastMessageAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
}).strict();

export const sessionMessageSchema = z.object({
  schemaVersion: z.literal("session-message.v1"),
  id: z.string().min(1),
  sessionId: z.string().min(1),
  bookId: z.string().nullable(),
  parentMessageId: z.string().nullable(),
  role: sessionMessageRoleSchema,
  content: z.string(),
  contentHash: z.string().min(1),
  tokenEstimate: z.number().int().nonnegative(),
  metadata: z.record(z.unknown()),
  createdAt: isoDateTimeSchema
}).strict();

export const sessionCreateInputSchema = z.object({
  bookId: z.string().min(1).nullable().default(null),
  title: z.string().trim().max(200).default(""),
  parentSessionId: z.string().min(1).nullable().default(null)
}).strict();

export const sessionMessageCreateInputSchema = z.object({
  role: sessionMessageRoleSchema,
  content: z.string().max(1_000_000),
  parentMessageId: z.string().min(1).nullable().default(null),
  metadata: z.record(z.unknown()).default({})
}).strict();

export const sessionSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  sessionId: z.string().min(1).optional(),
  bookId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional()
}).strict();

export const sessionSearchResultSchema = z.object({
  message: sessionMessageSchema,
  snippet: z.string(),
  rank: z.number().nullable()
}).strict();

export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type SessionMessage = z.infer<typeof sessionMessageSchema>;
export type SessionCreateInput = z.infer<typeof sessionCreateInputSchema>;
export type SessionMessageCreateInput = z.infer<typeof sessionMessageCreateInputSchema>;
export type SessionSearchInput = z.infer<typeof sessionSearchInputSchema>;
export type SessionSearchResult = z.infer<typeof sessionSearchResultSchema>;
