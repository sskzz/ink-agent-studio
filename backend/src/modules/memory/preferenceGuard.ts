import type { UserPreferenceProposalInput } from "@ink-agent/contracts";
import { badRequest } from "../../utils/errors.js";

const storyFactPatterns = [
  /(?:主角|男主|女主|反派|配角|角色|人物)(?:叫|名为|是|拥有|来自|最终|身份为|关系为)/,
  /(?:父亲|母亲|兄弟|姐妹|师父|恋人)(?:是|叫|名为)/,
  /(?:世界观|故事设定|地点|城市|国家|宗门|势力|时间线|年代|日期)(?:设定)?(?:是|为|叫|发生|位于|建立)/,
  /(?:故事|剧情|情节|结局|伏笔|线索)(?:是|为|发生|发生在|揭示|回收|指向|最终)/,
  /(?:能力|境界|武器|物品|法宝|功法)(?:是|为|叫|拥有|获得)/,
  /(?:protagonist|hero|heroine|antagonist|character|villain)\s+(?:is|was|has|comes from|will)/i,
  /(?:plot|ending|setting|timeline|foreshadowing)\s+(?:is|was|happens|reveals|points to)/i
];

/** 偏好记忆只能描述用户如何协作/写作，不能把作品事实伪装成长期偏好。 */
export function assertPreferenceOnly(input: UserPreferenceProposalInput) {
  const content = `${input.value}\n${input.reason}`.toLocaleLowerCase();
  const matched = storyFactPatterns.filter((pattern) => pattern.test(content)).map((pattern) => pattern.source);
  if (matched.length > 0) {
    throw badRequest("长期记忆只允许保存稳定写作偏好，疑似作品事实必须留在 BookState", {
      matchedTerms: matched.slice(0, 8),
      allowedKeys: [
        "narrative_pacing", "paragraph_length", "dialogue_density", "description_density",
        "emotion_expression", "banned_expressions", "review_strictness", "revision_scope",
        "output_format", "interaction_style"
      ]
    });
  }
}
