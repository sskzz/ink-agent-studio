export type ModelGatewayErrorKind =
  | "timeout"
  | "cancelled"
  | "rate_limited"
  | "unavailable"
  | "auth"
  | "invalid_request"
  | "malformed_response"
  | "unknown";

const publicMessages: Record<ModelGatewayErrorKind, string> = {
  timeout: "模型调用超时",
  cancelled: "模型调用已取消",
  rate_limited: "模型服务触发限流",
  unavailable: "模型服务暂时不可用",
  auth: "模型服务认证失败",
  invalid_request: "模型请求无效",
  malformed_response: "模型服务返回了无效响应",
  unknown: "模型调用失败"
};

export class ModelGatewayError extends Error {
  readonly kind: ModelGatewayErrorKind;
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(input: {
    kind: ModelGatewayErrorKind;
    retryable: boolean;
    status?: number | null;
    message?: string;
    cause?: unknown;
  }) {
    super(input.message ?? publicMessages[input.kind]);
    this.name = "ModelGatewayError";
    this.kind = input.kind;
    this.retryable = input.retryable;
    this.status = input.status ?? null;
    if (input.cause !== undefined) this.cause = input.cause;
  }
}

export function createHttpModelGatewayError(status: number) {
  if (status === 401 || status === 403) {
    return new ModelGatewayError({ kind: "auth", retryable: false, status });
  }
  if (status === 408 || status === 504) {
    return new ModelGatewayError({ kind: "timeout", retryable: true, status });
  }
  if (status === 429) {
    return new ModelGatewayError({ kind: "rate_limited", retryable: true, status });
  }
  if (status >= 500) {
    return new ModelGatewayError({ kind: "unavailable", retryable: true, status });
  }
  if (status >= 400) {
    return new ModelGatewayError({ kind: "invalid_request", retryable: false, status });
  }
  return new ModelGatewayError({ kind: "unknown", retryable: false, status });
}

export function malformedModelResponse(cause?: unknown) {
  return new ModelGatewayError({
    kind: "malformed_response",
    retryable: true,
    cause
  });
}

export function normalizeModelGatewayError(error: unknown, externalSignal?: AbortSignal) {
  if (error instanceof ModelGatewayError) return error;
  if (externalSignal?.aborted) {
    return new ModelGatewayError({ kind: "cancelled", retryable: false, cause: error });
  }

  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError") {
    return new ModelGatewayError({ kind: "timeout", retryable: true, cause: error });
  }
  if (name === "AbortError") {
    return new ModelGatewayError({ kind: "cancelled", retryable: false, cause: error });
  }
  if (error instanceof TypeError) {
    return new ModelGatewayError({ kind: "unavailable", retryable: true, cause: error });
  }
  return new ModelGatewayError({ kind: "unknown", retryable: false, cause: error });
}

/** 只返回可安全写入事件和 SQLite 的字段，不持久化响应正文、请求头或底层异常消息。 */
export function serializeModelGatewayError(error: ModelGatewayError) {
  return {
    name: error.name,
    kind: error.kind,
    message: error.message,
    retryable: error.retryable,
    status: error.status
  };
}
