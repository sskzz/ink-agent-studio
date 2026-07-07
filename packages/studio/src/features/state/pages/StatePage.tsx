const stateFiles = ["world.json", "characters.json", "plot.json", "memory.sqlite"];

export function StatePage() {
  return (
    <div className="page">
      <p className="eyebrow">State Store</p>
      <h2>世界状态</h2>
      <p className="muted">本页用于查看和编辑作品状态，核心原则是 JSON 权威、Markdown 可读、SQLite 可检索。</p>

      <section className="state-grid">
        {stateFiles.map((file) => (
          <article className="state-card" key={file}>
            <strong>{file}</strong>
            <p>等待本地状态管理服务接入。</p>
          </article>
        ))}
      </section>
    </div>
  );
}
