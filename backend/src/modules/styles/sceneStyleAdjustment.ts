import type { SceneType } from "../../schemas/styleVersionSchemas.js";

export interface SceneStyleAdjustment {
  sceneType: SceneType;
  metricAdjustments: Record<string, { centerDelta?: number; rangeScale?: number; maximumDelta?: number }>;
  semanticAdjustments: string[];
}

export function getSceneStyleAdjustment(sceneType: SceneType): SceneStyleAdjustment {
  const policies: Record<SceneType, Omit<SceneStyleAdjustment, "sceneType">> = {
    action: {
      metricAdjustments: {
        averageSentenceLength: { centerDelta: -3, rangeScale: 1.25, maximumDelta: 6 },
        shortSentenceRatio: { centerDelta: 0.12, rangeScale: 1.2, maximumDelta: 0.2 },
        actionWordDensity: { centerDelta: 2, rangeScale: 1.35, maximumDelta: 4 }
      },
      semanticAdjustments: ["动作场景允许节奏加快，但不得改变叙事人称和人物能力边界。"]
    },
    dialogue: {
      metricAdjustments: { dialogueCharacterRatio: { centerDelta: 0.15, rangeScale: 1.35, maximumDelta: 0.25 } },
      semanticAdjustments: ["提高对白占比，同时保持人物潜台词和既有说话方式。"]
    },
    introspection: {
      metricAdjustments: { psychologyWordDensity: { centerDelta: 1.5, rangeScale: 1.3, maximumDelta: 3 } },
      semanticAdjustments: ["允许心理描写增加，但不得使用连续因果解释替代人物反应。"]
    },
    description: {
      metricAdjustments: { averageSentenceLength: { centerDelta: 3, rangeScale: 1.25, maximumDelta: 6 }, sensoryWordDensity: { centerDelta: 1.5, rangeScale: 1.3, maximumDelta: 3 } },
      semanticAdjustments: ["允许环境与感官描写增加，但必须服务于当前场景。"]
    },
    suspense: { metricAdjustments: { paragraphSummaryCandidateRatio: { centerDelta: -0.05, rangeScale: 0.9, maximumDelta: 0.08 } }, semanticAdjustments: ["延迟解释，保留信息差和可验证线索。"] },
    climax: { metricAdjustments: { sentenceLengthStdDev: { centerDelta: 2, rangeScale: 1.5, maximumDelta: 5 } }, semanticAdjustments: ["高潮允许节奏波动扩大，但不得用抽象总结替代事件结果。"] },
    transition: { metricAdjustments: { averageLineLength: { centerDelta: -2, rangeScale: 1.4, maximumDelta: 6 } }, semanticAdjustments: ["过渡应简洁明确，不新增无关设定。"] },
    daily: { metricAdjustments: {}, semanticAdjustments: ["保持自然日常节奏和人物关系细节。"] },
    mixed: { metricAdjustments: {}, semanticAdjustments: [] }
  };
  return { sceneType, ...policies[sceneType] };
}
