import { Bot, Box, MessageCircle, PencilLine, Sparkles } from "lucide-react";

const assistantMessages = [
  {
    author: "创作助手",
    content: "已读取当前作品设定、章节规划和角色状态。你可以直接输入下一步写作目标，我会协助整理线索、生成草稿或检查设定一致性。",
    note: "内容由 AI 生成，仅供参考。"
  }
];

const inspirationCards = [
  { label: "工作流", value: "从细纲生成章节，再进入审稿与润色。" },
  { label: "其他", value: "后续可接入灵感收藏、设定片段和临时脑洞。" }
];

export function AssistantChat() {
  return (
    <div className="novel-assistant-chat">
      <div className="novel-assistant-tools" aria-label="AI 对话工具">
        <Bot size={15} />
        <span>默认创作工具</span>
      </div>

      <div className="novel-assistant-messages">
        {assistantMessages.map((message) => (
          <article className="novel-assistant-message" key={message.content}>
            <div className="novel-assistant-avatar"><Bot size={15} /></div>
            <div>
              <strong>{message.author}</strong>
              <p>{message.content}</p>
              <small>{message.note}</small>
            </div>
          </article>
        ))}
      </div>

      <div className="novel-assistant-input">
        <div>
          <MessageCircle size={14} />
          <span>AI对话</span>
          <small>0/50000 字</small>
        </div>
        <textarea placeholder="输入写作目标、章节动作或设定问题。按 Enter 发送，Shift + Enter 换行。" />
      </div>
    </div>
  );
}

export function InspirationPanel() {
  return (
    <div className="novel-inspiration-panel">
      <div className="novel-inspiration-filter">
        <button className="active" type="button"><Sparkles size={14} />工作流</button>
        <button type="button"><Box size={14} />其他</button>
      </div>

      <div className="novel-inspiration-list">
        {inspirationCards.map((card) => (
          <article className="novel-inspiration-card" key={card.label}>
            <div><PencilLine size={15} /><strong>{card.label}</strong></div>
            <p>{card.value}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
