/**
 * 模型配置状态层（Zustand）。
 * 页面只调用 store 暴露的动作，不直接触碰 fetch；API 层负责与本地 Hono 后端通信。
 * 每次增删改后都重新拉取快照（configs + usage + analysis），保证分析面板与列表始终一致。
 */
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

/** 新建配置时的空表单草稿：默认 OpenAI 兼容协议与“写作”用途，降低首填成本。 */
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

/** 模型配置 store 状态切片：含列表、当前草稿、使用分配、加载/保存/测试等异步标志。 */
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

/** 并行拉取配置列表、用途分配与分析结果，作为页面初始化和变更后的统一快照来源。 */
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
      // 默认选中列表首个配置并同步到草稿，保证表单区始终有内容可看。
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
    // 切换选中项时清空上次的测试结果，避免旧结果误导用户。
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
    // 任何草稿改动都会使已保存的测试结果失效，这里统一清空。
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
      // 保存成功后整表刷新，并用后端返回的最新配置回填草稿，避免本地与磁盘不一致。
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
      // 删除后选中项回落到列表第一项，草稿同步跟随，保证表单区不悬挂在已删除配置上。
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
      // 若当前草稿正对应被设为默认的配置，用返回的列表项刷新其 isDefault 标记。
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

/** 把任意 unknown 异常归一为可展示的中文错误文案。 */
function toMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
