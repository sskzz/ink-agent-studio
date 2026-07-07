const runs = [
  ["run-001", "Planner", "queued"],
  ["run-002", "Writer", "waiting"],
  ["run-003", "Auditor", "idle"]
];

export function RunsPage() {
  return (
    <div className="page">
      <p className="eyebrow">Runs</p>
      <h2>运行记录</h2>
      <p className="muted">Agent 每次执行都应记录输入、输出、状态变更和失败原因，方便恢复与审计。</p>

      <div className="table-card">
        {runs.map(([id, agent, status]) => (
          <div className="table-row" key={id}>
            <span>{id}</span>
            <strong>{agent}</strong>
            <em>{status}</em>
          </div>
        ))}
      </div>
    </div>
  );
}
