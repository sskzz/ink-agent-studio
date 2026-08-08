/**
 * 模型配置页选项数据：服务商下拉、用途下拉与用途中文标签。
 * 与后端 ModelProvider / ModelPurpose 枚举保持一致，新增服务商或用途时同步维护此文件。
 */
import type { ModelProvider, ModelPurpose } from "@/shared/types/domain";

/** 模型服务商下拉选项：value 与后端 ModelProvider 枚举对应，hint 作为下拉中的补充说明。 */
export const providerOptions: Array<{ label: string; value: ModelProvider; hint: string }> = [
  { label: "OpenAI", value: "openai", hint: "OpenAI 官方 API，适合高质量规划、写作和审稿" },
  { label: "Azure OpenAI", value: "azure-openai", hint: "企业 Azure 部署，需配置资源域名和部署名" },
  { label: "OpenAI Compatible", value: "openai-compatible", hint: "OpenAI 兼容协议，适合三方中转站和自建网关" },
  { label: "Anthropic Claude", value: "anthropic", hint: "Anthropic 官方 API，适合长上下文审稿和规划" },
  { label: "Google Gemini", value: "gemini", hint: "Google Gemini API，适合多模态和长上下文任务" },
  { label: "DeepSeek", value: "deepseek", hint: "DeepSeek 官方服务，常用于高性价比写作/推理" },
  { label: "Qwen / DashScope", value: "qwen", hint: "通义千问 / 阿里云百炼 DashScope" },
  { label: "Moonshot / Kimi", value: "moonshot", hint: "月之暗面 Kimi，适合长上下文阅读和分析" },
  { label: "智谱 GLM", value: "zhipu", hint: "智谱 AI GLM 系列模型" },
  { label: "豆包 / 火山方舟", value: "doubao", hint: "字节火山方舟模型服务" },
  { label: "百川智能", value: "baichuan", hint: "百川大模型 API" },
  { label: "百度千帆", value: "baidu-qianfan", hint: "百度智能云千帆大模型平台" },
  { label: "腾讯混元", value: "tencent-hunyuan", hint: "腾讯混元模型服务" },
  { label: "MiniMax", value: "minimax", hint: "MiniMax 官方模型 API" },
  { label: "Mistral AI", value: "mistral", hint: "Mistral 官方 API，适合多语言和开放模型生态" },
  { label: "xAI", value: "xai", hint: "xAI Grok 系列模型 API" },
  { label: "Cohere", value: "cohere", hint: "Cohere 文本生成、重排和向量能力" },
  { label: "OpenRouter", value: "openrouter", hint: "三方模型聚合平台，通常使用 OpenAI 兼容协议" },
  { label: "One API", value: "oneapi", hint: "自建或三方中转网关，统一 OpenAI 兼容调用" },
  { label: "LiteLLM", value: "litellm", hint: "自建模型网关，可统一多厂商协议" },
  { label: "Ollama", value: "ollama", hint: "本地模型服务，默认 http://127.0.0.1:11434/v1" },
  { label: "LM Studio", value: "lmstudio", hint: "本地桌面模型服务，支持 OpenAI 兼容接口" },
  { label: "vLLM", value: "vllm", hint: "本地/服务器自部署推理服务，适合高并发" },
  { label: "Custom", value: "custom", hint: "自定义服务商或尚未内置的协议" }
];

/** 模型用途下拉选项：与后端 ModelPurpose 枚举一一对应。 */
export const purposeOptions: Array<{ label: string; value: ModelPurpose }> = [
  { label: "规划", value: "planning" },
  { label: "写作", value: "writing" },
  { label: "审稿", value: "review" },
  { label: "向量/记忆", value: "embedding" },
  { label: "图片/封面", value: "image" }
];

/** 用途值到中文标签的映射，供表格、徽章等非下拉场景直接取用。 */
export const purposeLabel: Record<ModelPurpose, string> = {
  planning: "规划",
  writing: "写作",
  review: "审稿",
  embedding: "向量/记忆",
  image: "图片/封面"
};

/** DeepSeek 思考模式推理强度选项（与后端 modelThinkingConfigSchema 保持一致）。 */
export const reasoningEffortOptions: Array<{ label: string; value: "low" | "high" | "max" }> = [
  { label: "low（快速）", value: "low" },
  { label: "high（标准）", value: "high" },
  { label: "max（深度）", value: "max" }
];
