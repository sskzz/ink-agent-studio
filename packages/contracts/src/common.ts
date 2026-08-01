import { z } from "zod";

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const nonNegativeIntegerSchema = z.number().int().nonnegative();

export const positiveIntegerSchema = z.number().int().positive();

export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;
