import { z } from "zod";

export const entityTypeSchema = z.enum(["character", "faction", "location", "item"]);

export const bookEntityRecordSchema = z.object({
  id: z.string(),
  bookId: z.string(),
  entityType: entityTypeSchema,
  name: z.string(),
  role: z.string(),
  description: z.string(),
  fileId: z.string().nullable(),
  attributes: z.record(z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const bookEntitiesIndexSchema = z.array(bookEntityRecordSchema);

export const entityUpsertInputSchema = z.object({
  id: z.string().optional(),
  entityType: entityTypeSchema,
  name: z.string().trim().min(1, "名称不能为空"),
  role: z.string().trim().optional().default(""),
  description: z.string().optional().default(""),
  attributes: z.record(z.unknown()).optional().default({})
});

export type EntityUpsertInput = z.infer<typeof entityUpsertInputSchema>;
