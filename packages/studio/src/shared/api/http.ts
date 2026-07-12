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

function createUrl(path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${API_BASE_URL}/${path.replace(/^\//, "")}`;
}

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

export async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path, {
    method: "GET"
  });
}

export async function apiPost<T>(path: string, body?: JsonBody): Promise<T> {
  return apiRequest<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export async function apiPatch<T>(path: string, body?: JsonBody): Promise<T> {
  return apiRequest<T>(path, {
    method: "PATCH",
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export async function apiPut<T>(path: string, body?: JsonBody): Promise<T> {
  return apiRequest<T>(path, {
    method: "PUT",
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export async function apiDelete<T>(path: string): Promise<T> {
  return apiRequest<T>(path, {
    method: "DELETE"
  });
}
