import type { ModelProvider, ModelPurpose } from "@/shared/types/domain";

export const providerOptions: Array<{ label: string; value: ModelProvider; hint: string }> = [
  { label: "OpenAI Compatible", value: "openai-compatible", hint: "适合 DeepSeek、OneAPI、中转服务" },
  { label: "Ollama", value: "ollama", hint: "本地模型服务" },
  { label: "DeepSeek", value: "deepseek", hint: "DeepSeek 官方服务" },
  { label: "Gemini", value: "gemini", hint: "Google Gemini" },
  { label: "Moonshot", value: "moonshot", hint: "月之暗面/Kimi" },
  { label: "Custom", value: "custom", hint: "自定义服务商" }
];

export const purposeOptions: Array<{ label: string; value: ModelPurpose }> = [
  { label: "规划", value: "planning" },
  { label: "写作", value: "writing" },
  { label: "审稿", value: "review" },
  { label: "向量/记忆", value: "embedding" },
  { label: "图片/封面", value: "image" }
];

export const purposeLabel: Record<ModelPurpose, string> = {
  planning: "规划",
  writing: "写作",
  review: "审稿",
  embedding: "向量/记忆",
  image: "图片/封面"
};
