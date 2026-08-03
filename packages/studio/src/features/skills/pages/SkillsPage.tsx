/**
 * 小说技能页：展示技能目录并切换启停状态。
 * 技能只提供工作流约束、不直接改作品状态；列表与启停均走本地后端。
 */
import type { NovelSkillMetadata } from "@ink-agent/contracts";
import { useEffect, useState } from "react";
import { Badge } from "@/shared/components/ui/Badge";
import { PageHeader } from "@/shared/components/ui/PageHeader";
import { listSkills, setSkillEnabled } from "@/shared/api/skillsApi";

/** 技能适用阶段 → 中文标签。 */
const operationLabels: Record<string, string> = { planning: "规划", writing: "写作", review: "审稿" };

/** 小说技能页主组件：加载技能目录并管理启停切换。 */
export function SkillsPage() {
  const [skills, setSkills] = useState<NovelSkillMetadata[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // 挂载时加载技能目录，失败时展示错误文案。
  useEffect(() => {
    void listSkills().then(setSkills).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setLoading(false));
  }, []);

  /** 切换技能启停：成功后用后端返回的最新元数据原位替换列表条目。 */
  async function toggle(skill: NovelSkillMetadata) {
    try {
      const updated = await setSkillEnabled(skill.id, !skill.enabled);
      setSkills((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <div className="page skills-page">
      <PageHeader
        eyebrow="Novel Skills"
        title="小说技能"
        description="技能按本轮指令渐进加载，只提供工作流约束，不直接修改作品权威状态。"
      />
      {error ? <p className="anti-ai-state error">{error}</p> : null}
      {loading ? <p className="muted">正在读取技能目录...</p> : null}
      <section className="skills-grid">
        {skills.map((skill) => (
          <article className={`skill-card${skill.enabled ? "" : " disabled"}`} key={skill.id}>
            <div className="skill-card-head"><div><h3>{skill.name}</h3><p>{skill.description}</p></div><Badge tone={skill.enabled ? "sage" : "rose"}>{skill.enabled ? "启用" : "停用"}</Badge></div>
            <div className="skill-card-meta"><span>{skill.source === "builtin" ? "内置" : "自定义"} · v{skill.version}</span><span>优先级 {skill.priority}</span><span>{skill.instructionEstimatedTokens} Token</span></div>
            <div className="skill-card-tags">{skill.appliesTo.map((operation) => <Badge tone="blue" key={operation}>{operationLabels[operation] ?? operation}</Badge>)}</div>
            <button className={skill.enabled ? "ghost-button" : "primary-button"} type="button" onClick={() => void toggle(skill)}>{skill.enabled ? "停用技能" : "启用技能"}</button>
          </article>
        ))}
      </section>
    </div>
  );
}
