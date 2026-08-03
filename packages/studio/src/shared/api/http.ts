/**
 * 统一 HTTP 请求层：封装 fetch 与后端响应拆包。
 * 所有业务 API 都基于这里的 apiGet/apiPost 等方法，集中处理错误归一、JSON 序列化与
 * 后端 { code, message, data } envelope 约定，页面层不感知传输细节。
 */

/** 业务请求失败时抛出的统一错误类型：携带 HTTP 状态码与后端业务 code。 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: number,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

/** 后端统一响应结构：code 为 0 表示成功，非 0 视为业务错误。 */
interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

type JsonBody = unknown;

const DEFAULT_API_BASE_URL = "/api/v1";
const viteEnv = (import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env;

/**
 * 前端统一 API 根地址。
 * 开发环境默认走 Vite 的 /api 代理，避免 5173/5174/5175 端口漂移时触发 CORS。
 * 如果后续需要切换远端服务，只要在 .env 中配置 VITE_API_BASE_URL。
 */
export const API_BASE_URL =
  viteEnv?.VITE_API_BASE_URL?.replace(/\/$/, "") ?? DEFAULT_API_BASE_URL;

/** 拼接请求地址：绝对 URL 直接使用，相对路径统一挂在 API_BASE_URL 下并去除多余斜杠。 */
function createUrl(path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${API_BASE_URL}/${path.replace(/^\//, "")}`;
}

/** 解析响应：HTTP 非 2xx 与业务 code 非 0 都归一为 ApiError，成功时返回拆包后的 data。 */
async function parseResponse<T>(response: Response, path: string): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    const envelope = payload as Partial<ApiEnvelope<unknown>> | null;
    throw new ApiError(
      envelope?.message || `请求失败：${path}`,
      response.status,
      typeof envelope?.code === "number" ? envelope.code : undefined,
      envelope?.data
    );
  }

  const envelope = payload as Partial<ApiEnvelope<T>> | null;

  // 后端约定所有业务接口返回 { code, message, data }，这里统一拆包，页面层不再关心 envelope。
  if (envelope && typeof envelope === "object" && "code" in envelope && "data" in envelope) {
    if (envelope.code !== 0) {
      throw new ApiError(envelope.message || `请求失败：${path}`, response.status, envelope.code, envelope.data);
    }

    return envelope.data as T;
  }

  return payload as T;
}

/** 统一发起请求：有 body 时自动设置 JSON 头，其余情况交给各方法控制 method。 */
async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(createUrl(path), {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers
    }
  });

  return parseResponse<T>(response, path);
}

/** GET 请求：只读接口使用。 */
export async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path, {
    method: "GET"
  });
}

/** POST 请求：创建资源或触发动作；body 缺省时不携带请求体。 */
export async function apiPost<T>(path: string, body?: JsonBody): Promise<T> {
  return apiRequest<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

/** PATCH 请求：局部更新资源。 */
export async function apiPatch<T>(path: string, body?: JsonBody): Promise<T> {
  return apiRequest<T>(path, {
    method: "PATCH",
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

/** PUT 请求：整体替换资源。 */
export async function apiPut<T>(path: string, body?: JsonBody): Promise<T> {
  return apiRequest<T>(path, {
    method: "PUT",
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

/** DELETE 请求：删除资源。 */
export async function apiDelete<T>(path: string): Promise<T> {
  return apiRequest<T>(path, {
    method: "DELETE"
  });
}
