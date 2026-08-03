/**
 * 文件职责：定义跨模块复用的基础标量契约（ISO 时间、整数）。
 * 供前后端共同校验，其余 schema（runs、sessions 等）都引用这里的基元。
 */
import { z } from "zod";

/**
 * ISO 8601 日期时间，要求携带时区偏移。
 * 统一全系统时间表示，避免后端存储本地时间、前端解析出歧义。
 */
export const isoDateTimeSchema = z.string().datetime({ offset: true });

/** 非负整数：用于序号（seq）、token 数等不允许为负的计数。 */
export const nonNegativeIntegerSchema = z.number().int().nonnegative();

/** 正整数：用于次数、配额等必须大于 0 的计数。 */
export const positiveIntegerSchema = z.number().int().positive();

/** ISO 8601 时间字符串类型（与 isoDateTimeSchema 对应）。 */
export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;
