/**
 * 本地中文向量服务。
 *
 * 使用 Transformers.js 在 Node 进程内执行 bge-small-zh ONNX 推理。模型默认只从工作区缓存读取，
 * 避免首次生成章节时静默下载大文件；用户显式开启 autoDownload 后才允许从模型仓库下载并缓存。
 */
import path from "node:path";
import type { AppConfig } from "@ink-agent/contracts";
import { pipeline } from "@huggingface/transformers";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";

export interface TextEmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number;
  embedDocuments(texts: string[]): Promise<number[][] | null>;
  embedQuery(text: string): Promise<number[] | null>;
}

type FeatureExtractor = (
  input: string | string[],
  options: { pooling: "mean"; normalize: true; truncation: true; max_length: number }
) => Promise<{ tolist(): unknown }>;

const providers = new Map<string, LocalBgeEmbeddingService>();

export function getLocalEmbeddingProvider(
  paths: WorkspacePaths,
  config: AppConfig["memory"]["embedding"]
): TextEmbeddingProvider | null {
  if (!config.enabled) return null;
  const cacheDir = path.join(paths.indexDir, "models");
  const key = `${cacheDir}\u0000${config.modelId}\u0000${config.autoDownload}`;
  const existing = providers.get(key);
  if (existing) return existing;
  const provider = new LocalBgeEmbeddingService({
    modelId: config.modelId,
    dimensions: config.dimensions,
    cacheDir,
    autoDownload: config.autoDownload
  });
  providers.set(key, provider);
  return provider;
}

export class LocalBgeEmbeddingService implements TextEmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number;
  private readonly cacheDir: string;
  private readonly autoDownload: boolean;
  private extractorPromise: Promise<FeatureExtractor | null> | null = null;

  constructor(options: { modelId: string; dimensions: number; cacheDir: string; autoDownload: boolean }) {
    this.modelId = options.modelId;
    this.dimensions = options.dimensions;
    this.cacheDir = options.cacheDir;
    this.autoDownload = options.autoDownload;
  }

  async embedDocuments(texts: string[]) {
    if (texts.length === 0) return [];
    return this.embed(texts.map((text) => compactEmbeddingText(text)));
  }

  async embedQuery(text: string) {
    const vectors = await this.embed([`为这个句子生成表示以用于检索相关文章：${compactEmbeddingText(text)}`]);
    return vectors?.[0] ?? null;
  }

  private async embed(texts: string[]): Promise<number[][] | null> {
    const extractor = await this.getExtractor();
    if (!extractor) return null;
    try {
      const output = await extractor(texts, {
        pooling: "mean",
        normalize: true,
        truncation: true,
        max_length: 512
      });
      const raw = output.tolist();
      const rows = normalizeRows(raw);
      if (rows.some((row) => row.length !== this.dimensions)) return null;
      return rows;
    } catch {
      return null;
    }
  }

  private getExtractor() {
    this.extractorPromise ??= this.loadExtractor();
    return this.extractorPromise;
  }

  private async loadExtractor(): Promise<FeatureExtractor | null> {
    try {
      const created = await pipeline("feature-extraction", this.modelId, {
        device: "cpu",
        dtype: "q8",
        cache_dir: this.cacheDir,
        local_files_only: !this.autoDownload
      });
      return created as unknown as FeatureExtractor;
    } catch {
      // 本地模型未安装、ONNX runtime 不可用或下载失败时，检索层会自动退回 BM25/实体/时间。
      return null;
    }
  }
}

function compactEmbeddingText(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return Array.from(normalized).slice(0, 4_000).join("");
}

function normalizeRows(value: unknown): number[][] {
  if (!Array.isArray(value)) return [];
  if (value.length > 0 && typeof value[0] === "number") return [value as number[]];
  return value
    .filter((row): row is number[] => Array.isArray(row) && row.every((item) => typeof item === "number"))
    .map((row) => [...row]);
}
