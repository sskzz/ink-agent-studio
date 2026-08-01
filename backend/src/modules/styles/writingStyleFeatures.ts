import type { WritingStyleLocalStats } from "./writingStyleAnalysisPrompt.js";
import type { WritingStyleFeatureProfile } from "../../schemas/styleSchemas.js";

const maxRepresentativeChars = 4000;
const shortSentenceLimit = 15;
const longSentenceLimit = 40;

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

/** 提取可复现、可解释的表层文体证据；语义风格仍由模型结合代表段落判断。 */
export function extractWritingStyleFeatures(content: string, sampleFileName: string) {
  const source = content.trim();
  const rawLines = source.split(/\r?\n/);
  const paragraphs = rawLines.map((line) => line.trim()).filter(Boolean);
  const sentences = source.split(/[。！？!?…]+/u).map((item) => item.trim()).filter(Boolean);
  const sentenceLengths = sentences.map((sentence) => sentence.length);
  const paragraphLengths = paragraphs.map((paragraph) => paragraph.length);
  const quoteLineCount = paragraphs.filter(hasDialogue).length;
  const dialogueCharacters = extractDialogueCharacters(source);
  const dialogueParagraphs = paragraphs.filter(hasDialogue);
  const pureDialogueCount = dialogueParagraphs.filter((paragraph) => isPureDialogue(paragraph)).length;
  const dialogueWithActionCount = dialogueParagraphs.filter((paragraph) => !isPureDialogue(paragraph)).length;
  const normalizedCharacters = Array.from(source.replace(/\s/gu, ""));
  const representativeSample = sampleRepresentativeParagraphs(paragraphs, maxRepresentativeChars);

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
    dialogueCharacterRatio: ratio(dialogueCharacters, normalizedCharacters.length),
    pureDialogueParagraphRatio: ratio(pureDialogueCount, dialogueParagraphs.length),
    dialogueWithActionRatio: ratio(dialogueWithActionCount, dialogueParagraphs.length),
    maxConsecutiveDialogueParagraphs: maxConsecutive(paragraphs.map(hasDialogue)),
    speechTagDensity: density(source, speechTags),
    quoteLineCount,
    blankLineRatio: ratio(rawLines.length - paragraphs.length, rawLines.length),
    firstPersonMarkerCount: countWords(source, ["我", "我们", "咱们"]),
    secondPersonMarkerCount: countWords(source, ["你", "你们", "您"]),
    thirdPersonMarkerCount: countWords(source, ["他", "她", "他们", "她们", "它", "它们"]),
    firstPersonMarkerDensity: density(source, ["我", "我们", "咱们"]),
    secondPersonMarkerDensity: density(source, ["你", "你们", "您"]),
    thirdPersonMarkerDensity: density(source, ["他", "她", "他们", "她们", "它", "它们"]),
    perceptionVerbDensity: density(source, perceptionWords),
    psychologyWordDensity: density(source, psychologyWords),
    actionWordDensity: density(source, actionWords),
    sensoryWordDensity: density(source, sensoryWords),
    environmentWordDensity: density(source, environmentWords),
    concreteObjectWordDensity: density(source, concreteObjectWords),
    abstractEmotionWordDensity: density(source, abstractEmotionWords),
    adjectiveAdverbMarkerDensity: density(source, modifierMarkers),
    questionMarkRatio: ratio(countMatches(source, /[？?]/gu), Math.max(sentences.length, 1)),
    exclamationMarkRatio: ratio(countMatches(source, /[！!]/gu), Math.max(sentences.length, 1)),
    ellipsisRatio: ratio(countMatches(source, /(?:……|\.{3,})/gu), Math.max(sentences.length, 1)),
    dashRatio: ratio(countMatches(source, /(?:——|—)/gu), Math.max(sentences.length, 1)),
    semicolonRatio: ratio(countMatches(source, /[；;]/gu), Math.max(sentences.length, 1)),
    colonRatio: ratio(countMatches(source, /[：:]/gu), Math.max(sentences.length, 1)),
    lexicalDiversity: lexicalDiversity(normalizedCharacters),
    repeatedBigramRatio: repeatedNgramRatio(normalizedCharacters, 2),
    repeatedTrigramRatio: repeatedNgramRatio(normalizedCharacters, 3),
    repeatedParagraphOpeningRatio: repeatedOpeningRatio(paragraphs),
    connectorDensity: density(source, connectors),
    causalExplanationDensity: density(source, causalMarkers),
    templatePatternDensity: round(templatePatterns.reduce((sum, pattern) => sum + countMatches(source, pattern), 0) * 1000 / Math.max(source.length, 1)),
    paragraphSummaryCandidateRatio: ratio(paragraphs.filter((paragraph) => summaryMarkers.some((marker) => paragraph.slice(-40).includes(marker))).length, paragraphs.length),
    sampleTruncated: representativeSample.length < source.length,
    sampledCharacterCount: representativeSample.length,
    detectedFileType: sampleFileName.includes(".") ? sampleFileName.split(".").pop()?.toLowerCase() ?? "unknown" : "unknown"
  };

  return { localStats: stats, sampleContent: representativeSample };
}

/** 只持久化可用于生成后量化比较的稳定指标，排除文件名、计数和抽样状态等运行元数据。 */
export function createWritingStyleFeatureProfile(stats: WritingStyleLocalStats): WritingStyleFeatureProfile {
  return {
    schemaVersion: "style-features.v1",
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
      repeatedBigramRatio: stats.repeatedBigramRatio,
      repeatedTrigramRatio: stats.repeatedTrigramRatio,
      repeatedParagraphOpeningRatio: stats.repeatedParagraphOpeningRatio,
      connectorDensity: stats.connectorDensity,
      causalExplanationDensity: stats.causalExplanationDensity,
      templatePatternDensity: stats.templatePatternDensity,
      paragraphSummaryCandidateRatio: stats.paragraphSummaryCandidateRatio
    }
  };
}

function hasDialogue(paragraph: string) { return /[“”「」『』"]/u.test(paragraph); }
function isPureDialogue(paragraph: string) { return /^(?:[“「『"]).+(?:[”」』"])[。！？!?…]*$/u.test(paragraph); }
function extractDialogueCharacters(content: string) { return [...content.matchAll(/[“「『"]([^”」』"]+)[”」』"]/gu)].reduce((sum, match) => sum + (match[1]?.length ?? 0), 0); }

function sampleRepresentativeParagraphs(paragraphs: string[], limit: number) {
  const complete = paragraphs.join("\n");
  if (complete.length <= limit) return complete;
  const anchors = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const selected = [...new Set(anchors.map((anchor) => Math.min(paragraphs.length - 1, Math.round((paragraphs.length - 1) * anchor))))]
    .map((index) => paragraphs[index]!);
  const perParagraphLimit = Math.floor((limit - Math.max(selected.length - 1, 0)) / Math.max(selected.length, 1));
  return selected.map((paragraph) => paragraph.slice(0, perParagraphLimit)).join("\n").slice(0, limit);
}

function average(values: number[]) { return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0; }
function standardDeviation(values: number[]) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return round(Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length));
}
function calculateLengthTransitionRatio(lengths: number[]) {
  if (lengths.length < 2) return 0;
  const bands = lengths.map((length) => length <= shortSentenceLimit ? "short" : length >= longSentenceLimit ? "long" : "medium");
  return ratio(bands.slice(1).filter((band, index) => band !== bands[index]).length, bands.length - 1);
}
function maxConsecutive(values: boolean[]) { let max = 0; let current = 0; for (const value of values) { current = value ? current + 1 : 0; max = Math.max(max, current); } return max; }
function density(content: string, words: string[]) { return round(countWords(content, words) * 1000 / Math.max(content.length, 1)); }
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
function lexicalDiversity(characters: string[]) { return ratio(new Set(characters).size, characters.length); }
function repeatedNgramRatio(characters: string[], size: number) {
  if (characters.length < size) return 0;
  const counts = new Map<string, number>();
  for (let index = 0; index <= characters.length - size; index++) { const gram = characters.slice(index, index + size).join(""); counts.set(gram, (counts.get(gram) ?? 0) + 1); }
  return ratio([...counts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0), characters.length - size + 1);
}
function repeatedOpeningRatio(paragraphs: string[]) { const openings = paragraphs.map((paragraph) => paragraph.slice(0, 4)).filter((opening) => opening.length >= 2); return ratio(openings.length - new Set(openings).size, openings.length); }
function ratio(value: number, total: number) { return total ? round(value / total) : 0; }
function round(value: number) { return Math.round(value * 100) / 100; }
function countMatches(content: string, pattern: RegExp) { return content.match(pattern)?.length ?? 0; }
