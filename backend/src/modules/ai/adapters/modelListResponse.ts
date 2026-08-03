/**
 * 文件职责：解析 OpenAI 兼容的 /models 列表响应。
 * 边界：只处理"列表"接口，不涉及 chat 接口；解析失败时抛出带修复建议的中文错误。
 */
export async function parseOpenAIModelListResponse(response: Response, errorPrefix: string) {
  if (!response.ok) {
    throw new Error(`${errorPrefix}：HTTP ${response.status}`);
  }

  const rawBody = await response.text();
  let payload: unknown;

  try {
    payload = rawBody.trim() ? JSON.parse(rawBody) : {};
  } catch {
    // 常见误配置：Base URL 少了 /v1 后缀导致拿到 HTML 网关页，这里给出可操作的排查提示
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

  // 提取模型 id，去重后按字典序排序，保证前端下拉列表稳定
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
