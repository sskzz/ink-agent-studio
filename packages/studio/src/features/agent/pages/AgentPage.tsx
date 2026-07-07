const agents = ["Architect", "Planner", "Composer", "Writer", "Auditor", "Reviser"];

export function AgentPage() {
  return (
    <div className="page">
      <p className="eyebrow">Pipeline</p>
      <h2>Agent 控制台</h2>
      <p className="muted">后续会从这里触发“规划下一章、生成正文、审稿、修订、同步状态”等动作。</p>

      <section className="agent-grid">
        {agents.map((agent) => (
          <article className="agent-card" key={agent}>
            <span className="agent-dot" />
            <h3>{agent}</h3>
            <p>{agent} 节点占位，等待接入 core pipeline。</p>
          </article>
        ))}
      </section>

      <form className="prompt-box">
        <textarea placeholder="输入自然语言指令，比如：根据当前大纲写下一章。" />
        <button className="primary-button" type="button">发送给 Agent</button>
      </form>
    </div>
  );
}
