/**
 * 编辑器中央内容面板：按导航项的 kind 渲染不同形态（空态 / 字段详情 / 章节写作区 /
 * 草稿 / 角色管理 / 新建实体表单）。目前为页面结构占位，接口接入后替换对应区块。
 */
import { Archive, CircleDotDashed, Plus } from "lucide-react";
import type { EditorNavItem } from "../types";

/** 中央面板主组件：纯展示型，交互仅限章节文本域与模拟表单。 */
export function EditorMainPanel({ item }: { item: EditorNavItem }) {
  return (
    <article className="novel-editor-card">
      <header className="novel-editor-card-head"><div><h2>{item.title}</h2><p>{item.summary}</p></div></header>
      <div className={`novel-editor-card-body ${item.kind}`}>
        {item.kind === "empty" ? (
          <div className="novel-editor-empty"><CircleDotDashed size={18} /><strong>暂无设定</strong><p>{item.paragraphs?.[0] ?? "后续可以在这里补充设定，AI 也可以根据上下文自动生成初稿。"}</p></div>
        ) : null}
        {item.kind === "role-manager" ? <RoleManagerPanel /> : null}
        {item.kind === "create-entity" ? <CreateEntityPanel item={item} /> : null}
        {item.fields ? (
          <dl className="novel-editor-field-grid">
            {item.fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd>{field.hint ? <small>{field.hint}</small> : null}</div>)}
          </dl>
        ) : null}
        {item.chips ? <div className="novel-editor-chip-list">{item.chips.map((chip) => <span key={chip}>{chip}</span>)}</div> : null}
        {item.kind === "chapter" ? <textarea className="novel-editor-writing-area" defaultValue={item.paragraphs?.join("\n\n") ?? ""} /> : null}
        {item.kind === "draft" ? (
          <div className="novel-editor-empty"><Archive size={18} /><strong>暂时没有内容，快来添加吧</strong><p>草稿箱将用于保存 AI 生成但尚未采纳的章节版本。</p></div>
        ) : null}
        {item.paragraphs && item.kind !== "empty" && item.kind !== "draft" ? (
          <div className="novel-editor-paragraphs">{item.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
        ) : null}
      </div>
    </article>
  );
}

/** 角色管理面板：主要/次要角色分组 + 添加入口（当前为模拟结构）。 */
function RoleManagerPanel() {
  return (
    <div className="novel-role-manager">
      {(["主要角色", "次要角色"] as const).map((title) => (
        <section key={title}>
          <div className="novel-role-section-head"><h3>{title}</h3><button type="button"><Plus size={14} />添加角色</button></div>
          <div className="novel-role-card-grid"><article className="novel-role-card"><span>暂无{title}</span><p>当前不显示前端示例角色，等待角色写入接口接入。</p></article></div>
        </section>
      ))}
    </div>
  );
}

/** 新建实体（势力/地点/物品）表单：字段文案由导航项配置驱动，暂未持久化。 */
function CreateEntityPanel({ item }: { item: EditorNavItem }) {
  return (
    <form className="novel-create-entity-form" onSubmit={(event) => event.preventDefault()}>
      <label><span>{item.createNameLabel ?? "名称"}</span><input placeholder={item.createPlaceholder ?? "请输入名称"} /></label>
      <label><span>{item.createDescriptionLabel ?? "描述"}</span><textarea placeholder="输入设定说明、可用线索、限制条件或后续需要 AI 补全的方向。" /></label>
      <div className="novel-create-entity-actions"><button className="primary-button" type="button">保存为模拟设定</button><button className="ghost-button" type="reset">清空</button></div>
    </form>
  );
}
