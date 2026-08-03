import { ZodError } from "zod";

/**
 * 统一业务错误。
 * 携带可读的 message、内部错误码 code 和 HTTP status；路由层与全局 onError 只依赖这一个错误类型输出响应。
 */
export class AppError extends Error {
  readonly code: number;
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, options: { code?: number; status?: number; details?: unknown } = {}) {
    super(message);
    this.name = "AppError";
    this.code = options.code ?? 10000;
    this.status = options.status ?? 500;
    this.details = options.details;
  }
}

/**
 * 把未知异常收敛成 AppError。
 * 这样路由层不需要关心异常来源，统一交给 Hono onError 输出安全响应。
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof ZodError) {
    return badRequest("请求参数校验失败", { issues: error.issues });
  }

  if (error instanceof Error) {
    return new AppError(error.message);
  }

  return new AppError("未知后端错误", { details: error });
}

/**
 * 构造 400 请求错误。
 * 入参校验失败时使用；details 可携带结构化问题列表，但不允许放敏感内容。
 */
export function badRequest(message: string, details?: unknown) {
  return new AppError(message, {
    code: 14000,
    status: 400,
    details
  });
}

/**
 * 构造 404 未找到错误。
 * 资源（作品、章节、实体、配置）不存在时使用。
 */
export function notFound(message: string, details?: unknown) {
  return new AppError(message, {
    code: 14040,
    status: 404,
    details
  });
}

/**
 * 构造 409 冲突错误。
 * 乐观锁 revision 不匹配、工作区被占用等并发冲突场景使用。
 */
export function conflict(message: string, details?: unknown) {
  return new AppError(message, {
    code: 14090,
    status: 409,
    details
  });
}
