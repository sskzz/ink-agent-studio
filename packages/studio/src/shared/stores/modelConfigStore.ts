import { create } from "zustand";
import {
  deleteModelConfig,
  getModelAnalysis,
  getModelUsageSettings,
  listModelConfigs,
  saveModelConfig,
  setDefaultModelConfig,
  setPurposeModel,
  testModelConnection
} from "@/shared/api/modelConfigApi";
import type {
  ModelAnalysis,
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
  apiModel: "",
  purpose: "writing",
  enabled: true,
  isDefault: false,
  capabilities: {},
  note: ""
};

interface ModelConfigState {
  analysis: ModelAnalysis | null;
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
  assignPurposeModel: (purpose: "planning" | "writing" | "review", modelId: string) => Promise<void>;
  testDraft: () => Promise<void>;
}

async function loadModelSnapshot() {
  const [configs, usage, analysis] = await Promise.all([
    listModelConfigs(),
    getModelUsageSettings(),
    getModelAnalysis()
  ]);

  return { analysis, configs, usage };
}

/**
 * 模型配置状态层。
 *
 * 页面只关心 store 暴露的动作，不直接碰 fetch。
 * API 层负责和本地 Hono 后端通信，页面保持稳定。
 */
export const useModelConfigStore = create<ModelConfigState>((set, get) => ({
  analysis: null,
  configs: [],
  draft: emptyDraft,
  usage: {
    writingModelId: null,
    reviewModelId: null,
    planningModelId: null
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
      const { analysis, configs, usage } = await loadModelSnapshot();
      set({
        analysis,
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
      const { analysis, configs, usage } = await loadModelSnapshot();
      set({
        analysis,
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
      const { analysis, configs, usage } = await loadModelSnapshot();
      set({
        analysis,
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
      const analysis = await getModelAnalysis();
      set({
        analysis,
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
      const analysis = await getModelAnalysis();
      set({ analysis, usage, saving: false });
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
