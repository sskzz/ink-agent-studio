import { Badge } from "@/shared/components/ui/Badge";

const metrics = [
  ["作品", "0", "等待创建第一本书"],
  ["章节", "0", "正文会以 Markdown 落盘"],
  ["Agent", "6", "规划、编排、写作、审稿、修订、同步"],
  ["状态层", "3", "JSON / Markdown / SQLite"]
];

export function DashboardPage() {
  return (
    <div className="page">
      <section className="hero-panel">
        <Badge tone="sage">Studio Shell</Badge>
        <h2>把创作流程变成可恢复、可审计、可继续的本地工作台。</h2>
        <p>
          第一阶段先搭好前端页面骨架：作品、编辑器、Agent、状态、模型和运行记录。后续每个页面都会接入
          core 包里的本地 Agent 管线。
        </p>
      </section>

      <section className="metric-grid">
        {metrics.map(([label, value, hint]) => (
          <article className="metric-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <p>{hint}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
