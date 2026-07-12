export async function parseOpenAIModelListResponse(response: Response, errorPrefix: string) {
  if (!response.ok) {
    throw new Error(`${errorPrefix}：HTTP ${response.status}`);
  }

  const rawBody = await response.text();
  let payload: unknown;

  try {
    payload = rawBody.trim() ? JSON.parse(rawBody) : {};
  } catch {
    const returnedHtml = rawBody.trimStart().startsWith("<");
    throw new Error(
      returnedHtml
        ? `${errorPrefix}：接口返回了 HTML，请确认 Base URL 指向 OpenAI 兼容 API 根路径（例如 https://example.com/v1），且 API Key 有权访问 /models。`
        : `${errorPrefix}：接口返回的内容不是合法 JSON。`
    );
  }

  const data = typeof payload === "object" && payload !== null ? (payload as { data?: unknown }).data : null;

  if (!Array.isArray(data)) {
    throw new Error(`${errorPrefix}：响应缺少 data 模型数组。`);
  }

  return Array.from(
    new Set(
      data
        .map((item) =>
          typeof item === "object" && item !== null ? (item as { id?: unknown }).id : null
        )
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  ).sort((left, right) => left.localeCompare(right));
}
