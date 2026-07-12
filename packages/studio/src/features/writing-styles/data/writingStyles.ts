export interface StyleParameter {
  label: string;
  value: string;
  description: string;
  score: number;
}

export interface AnalysisResult {
  summary: string;
  voiceProfile: string;
  structureRule: string;
  aiReductionRule: string;
  promptSnippet: string;
  parameters: StyleParameter[];
}

export interface WritingStyle {
  id: string;
  name: string;
  summary: string;
  sourceFiles: string[];
  searchKeywords: string;
  tags: string[];
  lastAnalyzed: string;
  metrics: {
    tone: string;
    rhythm: string;
    pointOfView: string;
    aiReduction: string;
  };
  analysis: AnalysisResult;
}

/**
 * 后端分析接口不可用时的兜底展示结果。
 * 注意：这不是风格列表数据，只用于“AI分析”失败后让用户看到页面结构。
 */
export const simulatedAnalysis: AnalysisResult = {
  summary:
    "模板作品显示出“短中句交替、情绪克制、细节先行”的倾向。建议写作模型优先复用节奏和观察角度，不直接复制原文措辞。",
  voiceProfile: "语气清爽、克制，有轻微电影镜头感；角色情绪通过动作和场景折射出来。",
  structureRule: "开段先给动作或场景锚点，中段推进信息，段尾用一个不完整细节留出余味。",
  aiReductionRule: "减少“仿佛、似乎、某种、无法言说”等泛化表达，避免每段结尾都做情绪总结。",
  promptSnippet:
    "按模板风格生成：短中句交替，动作优先，情绪不直说；减少总结式解释，保留不完整细节和自然停顿。",
  parameters: [
    {
      label: "叙事视角",
      value: "第三人称限知",
      description: "信息披露贴近主角感知，不提前解释全局真相。",
      score: 82
    },
    {
      label: "句式节奏",
      value: "短中句交替",
      description: "动作段压短，情绪和环境段适度拉长。",
      score: 76
    },
    {
      label: "去 AI 味规则",
      value: "动作替代表态",
      description: "用动作、物件和停顿承载情绪，减少抽象总结。",
      score: 89
    }
  ]
};
