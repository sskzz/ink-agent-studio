export function SettingsPage() {
  return (
    <div className="page">
      <p className="eyebrow">Local Settings</p>
      <h2>设置</h2>
      <section className="form-card">
        <label>
          工作区路径
          <input defaultValue="D:\\Ideaproduct\\ink-agent-studio\\data" />
        </label>
        <label>
          默认语言
          <input defaultValue="zh-CN" />
        </label>
        <label>
          自动保存间隔
          <input defaultValue="30s" />
        </label>
        <button className="primary-button" type="button">保存设置</button>
      </section>
    </div>
  );
}
