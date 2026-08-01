import { ZodError } from "zod";

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

export function badRequest(message: string, details?: unknown) {
  return new AppError(message, {
    code: 14000,
    status: 400,
    details
  });
}

export function notFound(message: string, details?: unknown) {
  return new AppError(message, {
    code: 14040,
    status: 404,
    details
  });
}

export function conflict(message: string, details?: unknown) {
  return new AppError(message, {
    code: 14090,
    status: 409,
    details
  });
}
