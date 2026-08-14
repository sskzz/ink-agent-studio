/**
 * 写作风格特征提取。
 * 职责：用纯规则从样本文本中计算可复现的表层文体指标（句长/段落/对白/人称/词类密度/标点/模板句式等），并抽取代表段落供模型语义分析；
 * 边界：纯本地计算、无模型依赖；指标只做统计不做判断，语义风格判断在模型层；代表段落抽样保证单次分析输入长度有界。
 */
import type { WritingStyleLocalStats } from "./writingStyleAnalysisPrompt.js";
import type { WritingStyleFeatureProfile } from "../../schemas/styleSchemas.js";

/** 代表段落抽样上限：控制模型输入长度，超长文本按锚点抽样。 */
const maxRepresentativeChars = 4000;
/** 长文本统计抽样上限：按 12 个位置均匀取样，避免全文 n-gram 指标随篇幅失真。 */
const maxStatisticalChars = 120_000;
const statisticalWindowCount = 12;
export const WRITING_STYLE_FEATURE_VERSION = "style-features.v2" as const;
/** 短句/长句字数阈值，用于节奏分档。 */
const shortSentenceLimit = 15;
const longSentenceLimit = 40;

/** 章节标题只作为结构边界，不作为元数据或正文风格证据。 */
const chapterHeadingPattern = /^(?:#{1,6}\s+)?第[0-9零〇一二三四五六七八九十百千万两]+(?:章|节|卷|部|回|幕)(?:\s*[:：._—-]?\s*.*)?$/u;
const outlineLinePattern = /^(?:[-*+]\s+|\d{1,3}[.)、]\s*)/u;
const metadataLinePattern = /^(?:书名|作者|分类|标签|状态|字数|更新时间|简介|来源|网址|版权|下载地址)\s*[:：]/u;
const speakerLinePattern = /^(?!书名|作者|分类|标签|状态|字数|更新时间|简介|来源|网址|版权|下载地址)[\p{L}\p{N}_·-]{1,12}\s*[:：]\s*\S+/u;

// 以下词表为启发式词典：覆盖常见网络小说词汇，漏词只会让密度偏低，不会造成误判
const perceptionWords = ["看见", "看到", "望见", "听见", "听到", "闻到", "察觉", "感觉", "注意到", "意识到"];
const psychologyWords = ["想", "想到", "觉得", "认为", "明白", "知道", "记得", "怀疑", "希望", "担心", "害怕", "后悔"];
const actionWords = ["走", "跑", "站", "坐", "抬", "低", "转", "推", "拉", "拿", "放", "握", "抓", "看", "望", "笑", "摇头", "点头", "停", "退", "靠"];
const sensoryWords = ["光", "暗", "亮", "声音", "响", "安静", "气味", "香", "臭", "冷", "热", "温", "疼", "痛", "粗糙", "柔软"];
const environmentWords = ["天", "雨", "风", "云", "雪", "阳光", "月光", "街", "路", "房间", "门", "窗", "墙", "地面", "夜", "清晨"];
const concreteObjectWords = ["桌", "椅", "杯", "碗", "刀", "钥匙", "手机", "书", "纸", "衣", "鞋", "车", "灯", "床", "钟", "烟"];
const abstractEmotionWords = ["情绪", "感觉", "感情", "悲伤", "痛苦", "幸福", "喜悦", "愤怒", "恐惧", "孤独", "绝望", "希望", "温暖"];
const modifierMarkers = ["很", "非常", "十分", "极其", "格外", "无比", "特别", "如此", "悄然", "缓缓", "轻轻", "静静", "默默"];
const speechTags = ["说", "问", "答", "喊", "叫", "道", "低语", "嘟囔", "喃喃", "反问"];
const connectors = ["然而", "但是", "可是", "不过", "于是", "然后", "接着", "同时", "因此", "所以", "毕竟", "其实", "当然", "显然"];
const causalMarkers = ["因为", "所以", "因此", "之所以", "是因为", "这意味着", "也就是说", "换句话说"];
const summaryMarkers = ["总之", "归根结底", "说到底", "这一刻", "他终于明白", "她终于明白", "这就是", "一切都", "原来"];
const templatePatterns = [/(?:不是).{0,20}(?:而是)/gu, /(?:仿佛|似乎|宛如|好像).{0,24}(?:一般|一样)?/gu, /(?:不仅).{0,20}(?:而且|还)/gu, /(?:既).{0,16}(?:又)/gu];

/**
 * 提取可复现、可解释的表层文体证据；语义风格仍由模型结合代表段落判断。
 * @param content 样本文本
 * @param sampleFileName 文件名（用于推断文件类型）
 * @returns 本地统计 + 代表段落（超长文本按位置锚点抽样）
 */
export function extractWritingStyleFeatures(content: string, sampleFileName: string) {
  const source = content.trim();
  const rawLines = source.split(/\r?\n/);
  const allParagraphs = rawLines.map((line) => line.trim()).filter(Boolean);
  const chapterHeadings = allParagraphs.filter(isChapterHeading);
  const paragraphs = allParagraphs.filter((line) => !isChapterHeading(line));
  const bodySource = paragraphs.join("\n");
  // 以句末标点切分句子（省略号视为句末），过滤空串
  const sentences = bodySource.split(/[。！？!?…]+/u).map((item) => item.trim()).filter(Boolean);
  const sentenceLengths = sentences.map((sentence) => sentence.length);
  const paragraphLengths = paragraphs.map((paragraph) => paragraph.length);
  const quoteLineCount = paragraphs.filter(hasDialogue).length;
  const dialogueCharacters = extractDialogueCharacters(bodySource);
  const dialogueParagraphs = paragraphs.filter(hasDialogue);
  const pureDialogueCount = dialogueParagraphs.filter((paragraph) => isPureDialogue(paragraph)).length;
  const dialogueWithActionCount = dialogueParagraphs.filter((paragraph) => !isPureDialogue(paragraph)).length;
  // 代表段落抽样：全文短时直接用全文，超长时按 0/20%/40%/60%/80%/100% 锚点位置取段落并均分字符预算
  const representativeSample = sampleRepresentativeParagraphs(paragraphs, maxRepresentativeChars);
  const statisticalSample = sampleStratifiedText(bodySource, maxStatisticalChars, statisticalWindowCount);
  const normalizedStatisticalCharacters = Array.from(normalizeForRepetition(statisticalSample));
  const outlineLines = paragraphs.filter((line) => outlineLinePattern.test(line));
  const metadataLines = paragraphs.filter((line) => metadataLinePattern.test(line));
  const classificationBody = paragraphs.filter((line) => !outlineLinePattern.test(line) && !metadataLinePattern.test(line));
  const proseLines = classificationBody.filter(isProseLine);
  const bodyCharacters = paragraphs.reduce((sum, line) => sum + line.length, 0);
  const proseCharacters = proseLines.reduce((sum, line) => sum + line.length, 0);
  const speakerLines = paragraphs.filter((line) => speakerLinePattern.test(line));

  const stats: WritingStyleLocalStats = {
    contentLength: source.length,
    paragraphCount: paragraphs.length,
    averageLineLength: average(paragraphLengths),
    sentenceCount: sentences.length,
    averageSentenceLength: average(sentenceLengths),
    sentenceLengthStdDev: standardDeviation(sentenceLengths),
    shortSentenceRatio: ratio(sentenceLengths.filter((length) => length <= shortSentenceLimit).length, sentences.length),
    longSentenceRatio: ratio(sentenceLengths.filter((length) => length >= longSentenceLimit).length, sentences.length),
    sentenceLengthTransitionRatio: calculateLengthTransitionRatio(sentenceLengths),
    independentShortParagraphRatio: ratio(paragraphLengths.filter((length) => length <= 15).length, paragraphs.length),
    paragraphLengthStdDev: standardDeviation(paragraphLengths),
    dialogueRatio: ratio(quoteLineCount, paragraphs.length),
    dialogueCharacterRatio: ratio(dialogueCharacters, bodySource.replace(/\s/gu, "").length),
    pureDialogueParagraphRatio: ratio(pureDialogueCount, dialogueParagraphs.length),
    dialogueWithActionRatio: ratio(dialogueWithActionCount, dialogueParagraphs.length),
    maxConsecutiveDialogueParagraphs: maxConsecutive(paragraphs.map(hasDialogue)),
    speechTagDensity: density(bodySource, speechTags),
    quoteLineCount,
    blankLineRatio: ratio(rawLines.length - paragraphs.length, rawLines.length),
    firstPersonMarkerCount: countWords(bodySource, ["我", "我们", "咱们"]),
    secondPersonMarkerCount: countWords(bodySource, ["你", "你们", "您"]),
    thirdPersonMarkerCount: countWords(bodySource, ["他", "她", "他们", "她们", "它", "它们"]),
    firstPersonMarkerDensity: density(bodySource, ["我", "我们", "咱们"]),
    secondPersonMarkerDensity: density(bodySource, ["你", "你们", "您"]),
    thirdPersonMarkerDensity: density(bodySource, ["他", "她", "他们", "她们", "它", "它们"]),
    perceptionVerbDensity: density(bodySource, perceptionWords),
    psychologyWordDensity: density(bodySource, psychologyWords),
    actionWordDensity: density(bodySource, actionWords),
    sensoryWordDensity: density(bodySource, sensoryWords),
    environmentWordDensity: density(bodySource, environmentWords),
    concreteObjectWordDensity: density(bodySource, concreteObjectWords),
    abstractEmotionWordDensity: density(bodySource, abstractEmotionWords),
    adjectiveAdverbMarkerDensity: density(bodySource, modifierMarkers),
    questionMarkRatio: ratio(countMatches(bodySource, /[？?]/gu), Math.max(sentences.length, 1)),
    exclamationMarkRatio: ratio(countMatches(bodySource, /[！!]/gu), Math.max(sentences.length, 1)),
    ellipsisRatio: ratio(countMatches(bodySource, /(?:……|\.{3,})/gu), Math.max(sentences.length, 1)),
    dashRatio: ratio(countMatches(bodySource, /(?:——|—)/gu), Math.max(sentences.length, 1)),
    semicolonRatio: ratio(countMatches(bodySource, /[；;]/gu), Math.max(sentences.length, 1)),
    colonRatio: ratio(countMatches(bodySource, /[：:]/gu), Math.max(sentences.length, 1)),
    lexicalDiversity: lexicalDiversity(normalizedStatisticalCharacters),
    repeated12GramRatio: repeatedNgramRatio(normalizedStatisticalCharacters, 12),
    duplicateParagraphRatio: duplicateParagraphRatio(paragraphs),
    repeatedParagraphOpeningRatio: repeatedOpeningRatio(paragraphs),
    connectorDensity: density(bodySource, connectors),
    causalExplanationDensity: density(bodySource, causalMarkers),
    templatePatternDensity: round(templatePatterns.reduce((sum, pattern) => sum + countMatches(bodySource, pattern), 0) * 1000 / Math.max(bodySource.length, 1)),
    paragraphSummaryCandidateRatio: ratio(paragraphs.filter((paragraph) => summaryMarkers.some((marker) => paragraph.slice(-40).includes(marker))).length, paragraphs.length),
    sampleTruncated: representativeSample.length < source.length,
    sampledCharacterCount: representativeSample.length,
    repetitionSampledCharacterCount: statisticalSample.length,
    chapterHeadingCount: chapterHeadings.length,
    headingRatio: ratio(chapterHeadings.length, allParagraphs.length),
    outlineLineRatio: ratio(outlineLines.length, paragraphs.length),
    metadataLineRatio: ratio(metadataLines.length, paragraphs.length),
    proseLineRatio: ratio(proseLines.length, classificationBody.length),
    proseCharacterRatio: ratio(proseCharacters, bodyCharacters),
    speakerLineRatio: ratio(speakerLines.length, paragraphs.length),
    bodyCharacterCount: bodySource.length,
    sentenceEndCount: countMatches(bodySource, /[。！？!?]/gu),
    detectedFileType: sampleFileName.includes(".") ? sampleFileName.split(".").pop()?.toLowerCase() ?? "unknown" : "unknown"
  };

  return { localStats: stats, sampleContent: representativeSample };
}

/** 只持久化可用于生成后量化比较的稳定指标，排除文件名、计数和抽样状态等运行元数据。 */
export function createWritingStyleFeatureProfile(stats: WritingStyleLocalStats): WritingStyleFeatureProfile {
  return {
    schemaVersion: WRITING_STYLE_FEATURE_VERSION,
    sourceContentLength: stats.contentLength,
    metrics: {
      averageSentenceLength: stats.averageSentenceLength,
      sentenceLengthStdDev: stats.sentenceLengthStdDev,
      shortSentenceRatio: stats.shortSentenceRatio,
      longSentenceRatio: stats.longSentenceRatio,
      sentenceLengthTransitionRatio: stats.sentenceLengthTransitionRatio,
      averageLineLength: stats.averageLineLength,
      independentShortParagraphRatio: stats.independentShortParagraphRatio,
      dialogueCharacterRatio: stats.dialogueCharacterRatio,
      pureDialogueParagraphRatio: stats.pureDialogueParagraphRatio,
      actionWordDensity: stats.actionWordDensity,
      psychologyWordDensity: stats.psychologyWordDensity,
      sensoryWordDensity: stats.sensoryWordDensity,
      environmentWordDensity: stats.environmentWordDensity,
      concreteObjectWordDensity: stats.concreteObjectWordDensity,
      abstractEmotionWordDensity: stats.abstractEmotionWordDensity,
      lexicalDiversity: stats.lexicalDiversity,
      repeatedParagraphOpeningRatio: stats.repeatedParagraphOpeningRatio,
      connectorDensity: stats.connectorDensity,
      causalExplanationDensity: stats.causalExplanationDensity,
      templatePatternDensity: stats.templatePatternDensity,
      paragraphSummaryCandidateRatio: stats.paragraphSummaryCandidateRatio
    }
  };
}

/** 段落是否含对白引号 */
function hasDialogue(paragraph: string) { return /[“”「」『』"]/u.test(paragraph); }
/** 整段是否为纯对白（整段被引号包裹） */
function isPureDialogue(paragraph: string) { return /^(?:[“「『"]).+(?:[”」』"])[。！？!?…]*$/u.test(paragraph); }
/** 统计引号内对白字符数，用于对白占比计算 */
function extractDialogueCharacters(content: string) { return [...content.matchAll(/[“「『"]([^”」』"]+)[”」』"]/gu)].reduce((sum, match) => sum + (match[1]?.length ?? 0), 0); }

/** 超长文本抽样：按 0/20%/…/100% 锚点位置选段落，均分字符预算逐段截取，保证采样覆盖全文而非只取开头。 */
function sampleRepresentativeParagraphs(paragraphs: string[], limit: number) {
  const complete = paragraphs.join("\n");
  if (complete.length <= limit) return complete;
  const anchors = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const selected = [...new Set(anchors.map((anchor) => Math.min(paragraphs.length - 1, Math.round((paragraphs.length - 1) * anchor))))]
    .map((index) => paragraphs[index]!);
  const perParagraphLimit = Math.floor((limit - Math.max(selected.length - 1, 0)) / Math.max(selected.length, 1));
  return selected.map((paragraph) => paragraph.slice(0, perParagraphLimit)).join("\n").slice(0, limit);
}

/** 对超长正文按位置均匀抽样，保证重复度计算的成本和长度偏差都有上限。 */
function sampleStratifiedText(content: string, limit: number, windows: number) {
  if (content.length <= limit) return content;
  const windowLength = Math.floor(limit / windows);
  const selected: string[] = [];
  for (let index = 0; index < windows; index += 1) {
    const center = Math.round((content.length - 1) * index / Math.max(windows - 1, 1));
    let start = Math.max(0, Math.min(content.length - windowLength, center - Math.floor(windowLength / 2)));
    if (start > 0) {
      const nextBreak = content.indexOf("\n", start);
      if (nextBreak >= 0 && nextBreak - start < 500) start = nextBreak + 1;
    }
    selected.push(content.slice(start, start + windowLength));
  }
  return selected.join("\n").slice(0, limit + windows);
}

function average(values: number[]) { return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0; }
function standardDeviation(values: number[]) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return round(Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length));
}
/** 相邻句子的长短分档变化占比：衡量节奏起伏程度 */
function calculateLengthTransitionRatio(lengths: number[]) {
  if (lengths.length < 2) return 0;
  const bands = lengths.map((length) => length <= shortSentenceLimit ? "short" : length >= longSentenceLimit ? "long" : "medium");
  return ratio(bands.slice(1).filter((band, index) => band !== bands[index]).length, bands.length - 1);
}
/** 最长连续命中数（如连续对白段数） */
function maxConsecutive(values: boolean[]) { let max = 0; let current = 0; for (const value of values) { current = value ? current + 1 : 0; max = Math.max(max, current); } return max; }
/** 词表密度：每千字的命中次数 */
function density(content: string, words: string[]) { return round(countWords(content, words) * 1000 / Math.max(content.length, 1)); }
/** 计数命中：先按词长降序匹配（长词优先），命中处用空格占位防止重叠计数 */
function countWords(content: string, words: string[]) {
  let remaining = content;
  let count = 0;
  for (const word of [...words].sort((left, right) => right.length - left.length)) {
    const parts = remaining.split(word);
    count += parts.length - 1;
    remaining = parts.join(" ");
  }
  return count;
}
/** 字种数占比：衡量用词丰富度 */
function lexicalDiversity(characters: string[]) { return ratio(new Set(characters).size, characters.length); }
/** 重复长片段占比：12 字片段在定长抽样中重复才计数，避免二元组随全文长度自然趋近 1。 */
function repeatedNgramRatio(characters: string[], size: number) {
  if (characters.length < size) return 0;
  const counts = new Map<string, number>();
  for (let index = 0; index <= characters.length - size; index++) { const gram = characters.slice(index, index + size).join(""); counts.set(gram, (counts.get(gram) ?? 0) + 1); }
  return ratio([...counts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0), characters.length - size + 1);
}
/** 完全重复段落的字符覆盖率；短段落和章节标题不计，重点识别广告、声明和重复粘贴。 */
function duplicateParagraphRatio(paragraphs: string[]) {
  const counts = new Map<string, { count: number; length: number }>();
  let totalCharacters = 0;
  for (const paragraph of paragraphs) {
    const normalized = normalizeForRepetition(paragraph);
    if (normalized.length < 12) continue;
    totalCharacters += normalized.length;
    const current = counts.get(normalized);
    counts.set(normalized, { count: (current?.count ?? 0) + 1, length: normalized.length });
  }
  const duplicateCharacters = [...counts.values()]
    .filter((item) => item.count > 1)
    .reduce((sum, item) => sum + (item.count - 1) * item.length, 0);
  return ratio(duplicateCharacters, totalCharacters);
}
/** 重复度归一化：兼容全半角，忽略空白、标点和符号，只比较有效文本片段。 */
function normalizeForRepetition(value: string) { return value.normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu, ""); }
/** 严格章节标题识别：只有短行且整行匹配时才视为标题。 */
function isChapterHeading(value: string) { return value.length <= 80 && chapterHeadingPattern.test(value); }
/** 正文证据：有句末标点，或包含足够汉字的长行。 */
function isProseLine(value: string) {
  if (/[。！？!?]/u.test(value)) return true;
  if (value.length < 20) return false;
  return ratio(countMatches(value, /[\p{Script=Han}]/gu), value.length) >= 0.5;
}
/** 段首开头重复占比：取每段前 4 字，重复出现次数越多说明段落开头越模板化 */
function repeatedOpeningRatio(paragraphs: string[]) { const openings = paragraphs.map((paragraph) => paragraph.slice(0, 4)).filter((opening) => opening.length >= 2); return ratio(openings.length - new Set(openings).size, openings.length); }
/** 比例计算：total 为 0 时返回 0 */
function ratio(value: number, total: number) { return total ? round(value / total) : 0; }
/** 保留两位小数 */
function round(value: number) { return Math.round(value * 100) / 100; }
/** 正则命中次数 */
function countMatches(content: string, pattern: RegExp) { return content.match(pattern)?.length ?? 0; }
