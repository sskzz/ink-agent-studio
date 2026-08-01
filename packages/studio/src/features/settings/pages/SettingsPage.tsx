import type { AppConfig } from "@ink-agent/contracts";
import { RefreshCw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError } from "@/shared/api/http";
import { PageHeader } from "@/shared/components/ui/PageHeader";
import { getSettings, reloadSettings, updateSettings } from "../api/settingsApi";

type SettingsStatus = "idle" | "loading" | "saving";

export function SettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<SettingsStatus>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void loadSettings();
  }, []);

  async function loadSettings() {
    setStatus("loading");
    setMessage("");

    try {
      const result = await getSettings();
      setConfig(result.effectiveConfig);
      setRevision(result.revision);
    } catch (error) {
      setMessage(toErrorMessage(error));
    } finally {
      setStatus("idle");
    }
  }

  async function saveSettings() {
    if (!config) return;
    setStatus("saving");
    setMessage("");

    try {
      const result = await updateSettings({
        expectedRevision: revision,
        changes: {
          general: config.general,
          runtime: config.runtime,
          events: config.events,
          models: config.models,
          context: config.context,
          sessions: config.sessions,
          memory: config.memory,
          skills: config.skills,
          patches: config.patches,
          storage: config.storage,
          plugins: config.plugins,
          mcp: config.mcp,
          cron: config.cron,
          features: config.features
        }
      });
      setConfig(result.effectiveConfig);
      setRevision(result.revision);
      setMessage("设置已保存");
    } catch (error) {
      setMessage(toErrorMessage(error));
    } finally {
      setStatus("idle");
    }
  }

  async function refreshSettings() {
    setStatus("loading");
    setMessage("");

    try {
      const result = await reloadSettings();
      setConfig(result.effectiveConfig);
      setRevision(result.revision);
    } catch (error) {
      setMessage(toErrorMessage(error));
    } finally {
      setStatus("idle");
    }
  }

  if (!config) {
    return (
      <div className="page">
        <PageHeader
          eyebrow="Local Settings"
          title="设置"
          description="读取和维护本地运行、上下文、记忆、技能与存储配置。"
        />
        <p className="muted" aria-live="polite">{message || "正在读取配置..."}</p>
        {message ? <button className="secondary-button" type="button" onClick={() => void loadSettings()}>重试</button> : null}
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Local Settings"
        title="设置"
        description="读取和维护本地运行、上下文、记忆、技能与存储配置。"
      />

      <section className="form-card">
        <h3>常规</h3>
        <label>
          默认语言
          <input
            value={config.general.locale}
            onChange={(event) => setConfig({
              ...config,
              general: { ...config.general, locale: event.target.value }
            })}
          />
        </label>
        <NumberField
          label="自动保存间隔（毫秒）"
          value={config.general.autosaveIntervalMs}
          onChange={(value) => setConfig({
            ...config,
            general: { ...config.general, autosaveIntervalMs: value }
          })}
        />

        <h3>运行队列</h3>
        <NumberField
          label="全局并发任务"
          value={config.runtime.globalConcurrency}
          onChange={(value) => setConfig({
            ...config,
            runtime: { ...config.runtime, globalConcurrency: value }
          })}
        />
        <NumberField
          label="单作品写入并发"
          value={config.runtime.perBookMutationConcurrency}
          onChange={(value) => setConfig({
            ...config,
            runtime: { ...config.runtime, perBookMutationConcurrency: value }
          })}
        />
        <NumberField
          label="排队上限"
          value={config.runtime.queueLimit}
          onChange={(value) => setConfig({
            ...config,
            runtime: { ...config.runtime, queueLimit: value }
          })}
        />

        <h3>功能开关</h3>
        <ToggleField
          label="异步 Run"
          checked={config.features.asyncRuns}
          onChange={(checked) => setConfig({
            ...config,
            features: { ...config.features, asyncRuns: checked }
          })}
        />
        <ToggleField
          label="Patch 应用"
          checked={config.features.patchApply}
          onChange={(checked) => setConfig({
            ...config,
            features: { ...config.features, patchApply: checked }
          })}
        />
        <ToggleField
          label="小说技能"
          checked={config.features.skills}
          onChange={(checked) => setConfig({
            ...config,
            features: { ...config.features, skills: checked },
            skills: { ...config.skills, enabled: checked }
          })}
        />

        <h3>长期偏好记忆</h3>
        <ToggleField
          label="在续写、审稿和润色中使用已批准偏好"
          checked={config.memory.enabled}
          onChange={(checked) => setConfig({
            ...config,
            memory: { ...config.memory, enabled: checked }
          })}
        />
        <NumberField
          label="Memory Prompt Token 预算"
          value={config.memory.promptTokenBudget}
          min={128}
          max={16000}
          onChange={(value) => setConfig({
            ...config,
            memory: { ...config.memory, promptTokenBudget: value }
          })}
        />
        <NumberField
          label="最多加载 Active 偏好数"
          value={config.memory.maxActiveEntries}
          min={1}
          max={1000}
          onChange={(value) => setConfig({
            ...config,
            memory: { ...config.memory, maxActiveEntries: value }
          })}
        />
        <p className="muted">新增偏好和归档操作始终需要明确确认；人物、剧情、世界观与伏笔不会写入长期偏好记忆。</p>

        <h3>模型与上下文</h3>
        <NumberField
          label="默认模型超时（毫秒）"
          value={config.models.defaultTimeoutMs}
          onChange={(value) => setConfig({
            ...config,
            models: { ...config.models, defaultTimeoutMs: value }
          })}
        />
        <NumberField
          label="默认上下文窗口"
          value={config.context.defaultContextWindow}
          onChange={(value) => setConfig({
            ...config,
            context: { ...config.context, defaultContextWindow: value }
          })}
        />
        <NumberField
          label="默认最大输出 Token"
          value={config.context.defaultMaxOutputTokens}
          onChange={(value) => setConfig({
            ...config,
            context: { ...config.context, defaultMaxOutputTokens: value }
          })}
        />

        <div className="form-actions">
          <button className="primary-button" type="button" disabled={status !== "idle"} onClick={() => void saveSettings()}>
            <Save size={16} aria-hidden="true" />
            {status === "saving" ? "保存中" : "保存"}
          </button>
          <button className="secondary-button" type="button" disabled={status !== "idle"} onClick={() => void refreshSettings()}>
            <RefreshCw size={16} aria-hidden="true" />
            重新读取
          </button>
        </div>
        <p className="muted" aria-live="polite">{message || `配置版本 ${revision}`}</p>
      </section>
    </div>
  );
}

function NumberField({
  label,
  value,
  min = 1,
  max,
  onChange
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange(value: number): void;
}) {
  return (
    <label>
      {label}
      <input
        min={min}
        max={max}
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) {
  return (
    <label className="settings-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function toErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return "配置已在其他位置更新，请重新读取后再保存。";
  }

  return error instanceof Error ? error.message : "设置操作失败";
}
