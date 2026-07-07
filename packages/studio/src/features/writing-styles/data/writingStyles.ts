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

// 第一版风格数据仍然是前端 mock；抽到共享文件后，作品创建页可以直接读取风格列表。
export const seedStyles: WritingStyle[] = [
  {
    id: "style-cinematic-suspense",
    name: "冷色电影感悬疑",
    summary: "适合推进悬疑、都市异闻和调查线，强调短句推进、环境压迫和克制的情绪泄露。",
    sourceFiles: ["雨夜调查片段.md", "旧城区人物对白.txt"],
    searchKeywords: "雨夜、旧城区、调查、冷色镜头",
    tags: ["悬疑", "克制", "电影感"],
    lastAnalyzed: "今天 16:20",
    metrics: {
      tone: "冷静、紧绷",
      rhythm: "短句推进",
      pointOfView: "第三人称限知",
      aiReduction: "降低解释腔"
    },
    analysis: {
      summary: "样章更依赖行动细节和环境压迫推进情绪，人物心理不直接摊开，适合做悬疑和调查线基底。",
      voiceProfile: "冷色、克制、带轻微疏离感；句尾尽量收住，不主动替读者总结。",
      structureRule: "动作段短句推进，发现线索后用一到两句环境描写降速。",
      aiReductionRule: "删除“他意识到/她突然觉得”等解释性句式，改用动作、停顿和物件反馈。",
      promptSnippet:
        "使用冷色电影感悬疑风格：短句推进、环境压迫、第三人称限知；避免总结式解释和模板化比喻。",
      parameters: [
        {
          label: "叙事视角",
          value: "第三人称限知",
          description: "镜头跟随主角，不提前揭露旁观者不知道的信息。",
          score: 86
        },
        {
          label: "句式节奏",
          value: "短句 + 少量长句收束",
          description: "行动段使用短句，心理段用较长句形成回声。",
          score: 78
        },
        {
          label: "去 AI 味规则",
          value: "减少总结式解释",
          description: "避免段尾频繁解释人物情绪，让动作和场景承担信息。",
          score: 92
        }
      ]
    }
  },
  {
    id: "style-warm-growth",
    name: "温暖成长群像",
    summary: "适合日常成长、团队羁绊和轻幻想作品，强调角色之间的细节互动和柔和节奏。",
    sourceFiles: ["社团日常样章.docx", "晨间集市片段.md", "角色对话样例.txt"],
    searchKeywords: "社团、晨间集市、群像、轻幻想",
    tags: ["成长", "群像", "温暖"],
    lastAnalyzed: "昨天 21:14",
    metrics: {
      tone: "明亮、松弛",
      rhythm: "中速铺陈",
      pointOfView: "多角色切换",
      aiReduction: "保留生活毛边"
    },
    analysis: {
      summary: "样章的核心魅力来自角色之间的小动作和生活物件，不急着制造强冲突，更适合温暖成长线。",
      voiceProfile: "明亮、轻松、有人情味；保留一点笨拙和停顿，让角色不像模板人设。",
      structureRule: "用对话推进人物关系，再用气味、触感、日常道具补足场景温度。",
      aiReductionRule: "避免过度鸡汤和整齐排比，允许句子长度不均匀，保留生活里的小毛边。",
      promptSnippet:
        "使用温暖成长群像风格：多写角色互动、日常物件和轻微瑕疵；避免过度鸡汤和整齐划一的句式。",
      parameters: [
        {
          label: "情绪基调",
          value: "温暖但不甜腻",
          description: "用生活细节表达亲近感，避免直接喊出口号。",
          score: 84
        },
        {
          label: "对话比例",
          value: "35% - 45%",
          description: "以对话推进人物关系，旁白只补足动作和场景。",
          score: 74
        },
        {
          label: "描写偏好",
          value: "触觉、气味、日常物件",
          description: "用可感知细节替代抽象形容词。",
          score: 88
        }
      ]
    }
  }
];

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
