/**
 * 文件职责：模型 API Key 的加密存储（AES-256-GCM）。
 * 边界：密钥与普通配置分开存放、只读密文；解密失败直接抛错而不是返回空密钥，
 * 避免调用方拿着空密钥静默重试。私钥来源：INK_AGENT_SECRET_KEY 或工作区路径派生（本地开发）。
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../../utils/jsonStore.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";

/** 密钥文件格式：{modelConfigId: 密文}。 */
const secretFileSchema = z.record(z.string(), z.string());
const algorithm = "aes-256-gcm";

/** 派生 32 字节加密密钥：优先环境变量，否则用工作区路径（保证本地默认可用）。 */
function deriveKey(paths: WorkspacePaths) {
  const source = process.env.INK_AGENT_SECRET_KEY ?? `local-dev:${paths.root}`;
  return createHash("sha256").update(source).digest();
}

/**
 * 加密 API Key。
 * 第一版本地自用时允许使用工作区路径派生密钥；正式使用建议配置 INK_AGENT_SECRET_KEY，
 * 避免移动数据目录后无法解密。
 */
function encryptSecret(plainText: string, paths: WorkspacePaths) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, deriveKey(paths), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptSecret(cipherText: string, paths: WorkspacePaths) {
  const [version, ivText, tagText, encryptedText] = cipherText.split(":");

  if (version !== "v1" || !ivText || !tagText || !encryptedText) {
    throw new Error("密钥密文格式不正确");
  }

  const decipher = createDecipheriv(algorithm, deriveKey(paths), Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64")),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

/** 读取密钥文件，缺失时按空对象处理。 */
async function readSecrets(paths: WorkspacePaths) {
  return readJsonFile(paths.modelSecretsFile, secretFileSchema, {});
}

/**
 * 保存模型密钥。
 * 密钥文件与普通模型配置分开存储，避免配置列表接口把 API Key 泄露给前端。
 */
export async function saveModelSecret(paths: WorkspacePaths, modelConfigId: string, apiKey: string) {
  const secrets = await readSecrets(paths);
  secrets[modelConfigId] = encryptSecret(apiKey, paths);
  await writeJsonFile(paths.modelSecretsFile, secrets);
}

/** 读取模型密钥；未保存过密钥时返回空串（部分服务商如 Ollama 允许无密钥）。 */
export async function getModelSecret(paths: WorkspacePaths, modelConfigId: string) {
  const secrets = await readSecrets(paths);
  const cipherText = secrets[modelConfigId];
  return cipherText ? decryptSecret(cipherText, paths) : "";
}

/** 删除模型密钥（配置删除时同步调用）。 */
export async function deleteModelSecret(paths: WorkspacePaths, modelConfigId: string) {
  const secrets = await readSecrets(paths);
  delete secrets[modelConfigId];
  await writeJsonFile(paths.modelSecretsFile, secrets);
}
