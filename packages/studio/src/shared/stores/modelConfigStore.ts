import { create } from "zustand";
import {
  deleteModelConfig,
  getModelUsageSettings,
  listModelConfigs,
  saveModelConfig,
  setDefaultModelConfig,
  setPurposeModel,
  testModelConnection
} from "@/shared/api/modelConfigApi";
import type {
  ModelConfig,
  ModelConfigDraft,
  ModelConnectionResult,
  ModelUsageSettings
} from "@/shared/types/domain";

const emptyDraft: ModelConfigDraft = {
  name: "",
  provider: "openai-compatible",
  baseUrl: "",
  apiKey: "",
  model: "",
  purpose: "writing",
  temperature: 0.7,
  maxTokens: 4096,
  enabled: true,
  isDefault: false,
  note: ""
};

interface ModelConfigState {
  configs: ModelConfig[];
  draft: ModelConfigDraft;
  usage: ModelUsageSettings;
  selectedId: string | null;
  loading: boolean;
  saving: boolean;
  testing: boolean;
  error: string | null;
  testResult: ModelConnectionResult | null;
  loadConfigs: () => Promise<void>;
  selectConfig: (config: ModelConfig) => void;
  createConfig: () => void;
  updateDraft: (patch: Partial<ModelConfigDraft>) => void;
  saveDraft: () => Promise<void>;
  removeConfig: (id: string) => Promise<void>;
  markDefault: (id: string) => Promise<void>;
  assignPurposeModel: (purpose: "writing" | "review", modelId: string) => Promise<void>;
  testDraft: () => Promise<void>;
}

/**
 * 模型配置状态层。
 *
 * 页面只关心 store 暴露的动作，不直接碰 localStorage / fetch。
 * 这样未来从 mock API 切到真实后端时，页面基本不用改。
 */
export const useModelConfigStore = create<ModelConfigState>((set, get) => ({
  configs: [],
  draft: emptyDraft,
  usage: {
    writingModelId: null,
    reviewModelId: null
  },
  selectedId: null,
  loading: false,
  saving: false,
  testing: false,
  error: null,
  testResult: null,

  async loadConfigs() {
    set({ loading: true, error: null });
    try {
      const [configs, usage] = await Promise.all([listModelConfigs(), getModelUsageSettings()]);
      set({
        configs,
        usage,
        loading: false,
        selectedId: configs[0]?.id ?? null,
        draft: configs[0] ?? emptyDraft
      });
    } catch (error) {
      set({ loading: false, error: toMessage(error) });
    }
  },

  selectConfig(config) {
    set({
      selectedId: config.id,
      draft: config,
      testResult: null,
      error: null
    });
  },

  createConfig() {
    set({
      selectedId: null,
      draft: emptyDraft,
      testResult: null,
      error: null
    });
  },

  updateDraft(patch) {
    set((state) => ({
      draft: {
        ...state.draft,
        ...patch
      },
      testResult: null
    }));
  },

  async saveDraft() {
    set({ saving: true, error: null });
    try {
      const saved = await saveModelConfig(get().draft);
      const configs = await listModelConfigs();
      const usage = await getModelUsageSettings();
      set({
        configs,
        usage,
        selectedId: saved.id,
        draft: configs.find((config) => config.id === saved.id) ?? saved,
        saving: false
      });
    } catch (error) {
      set({ saving: false, error: toMessage(error) });
    }
  },

  async removeConfig(id) {
    set({ saving: true, error: null });
    try {
      await deleteModelConfig(id);
      const configs = await listModelConfigs();
      const usage = await getModelUsageSettings();
      set({
        configs,
        usage,
        selectedId: configs[0]?.id ?? null,
        draft: configs[0] ?? emptyDraft,
        saving: false,
        testResult: null
      });
    } catch (error) {
      set({ saving: false, error: toMessage(error) });
    }
  },

  async markDefault(id) {
    set({ saving: true, error: null });
    try {
      const configs = await setDefaultModelConfig(id);
      set({
        configs,
        draft: configs.find((config) => config.id === get().selectedId) ?? get().draft,
        saving: false
      });
    } catch (error) {
      set({ saving: false, error: toMessage(error) });
    }
  },

  async assignPurposeModel(purpose, modelId) {
    set({ saving: true, error: null });
    try {
      const usage = await setPurposeModel(purpose, modelId);
      set({ usage, saving: false });
    } catch (error) {
      set({ saving: false, error: toMessage(error) });
    }
  },

  async testDraft() {
    set({ testing: true, error: null, testResult: null });
    try {
      const result = await testModelConnection(get().draft);
      set({ testing: false, testResult: result });
    } catch (error) {
      set({ testing: false, error: toMessage(error) });
    }
  }
}));

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
