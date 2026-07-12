import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

/**
 * 统一成功响应。
 * 前端后续替换 mock API 时，只需要固定读取 data 字段，避免每个接口返回格式不一致。
 */
export function ok<T>(data: T, message = "ok"): ApiResponse<T> {
  return {
    code: 0,
    message,
    data
  };
}

/**
 * 统一 JSON 输出方法。
 * 这里封装 Hono 的 c.json，后续如果要补充 traceId、分页元信息，也只需要改这一处。
 */
export function jsonOk<T>(context: Context, data: T, message = "ok", status = 200) {
  return context.json(ok(data, message), status as ContentfulStatusCode);
}

export interface ErrorResponseData {
  details?: unknown;
}

/**
 * 统一错误响应。
 * 错误信息会返回给前端展示，但 details 只放结构化调试信息，不应放 API Key 等敏感内容。
 */
export function jsonError(
  context: Context,
  code: number,
  message: string,
  status = 500,
  details?: unknown
) {
  return context.json(
    {
      code,
      message,
      data: details ? { details } : null
    },
    status as ContentfulStatusCode
  );
}
