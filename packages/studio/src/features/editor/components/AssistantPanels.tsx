/**
 * 编辑器 AI 会话栏（内容区底部，类似 CLI 会话：上方消息、下方输入框）。
 * 会话与左侧功能条目**一对一深度绑定**：
 * 1. 会话隔离：每个左侧条目（基础设置/故事基石/卷纲/当前状态/伏笔池/角色/背景/势力/
 *    地点/物品/章节等）拥有独立会话，会话键 = bookId + itemId，消息历史按条目分别缓存；
 * 2. 上下文注入：发送消息时把选中条目的实际内容快照（context.contentPreview，上限 3000 字符）
 *    与历史消息一并提交后端 /api/v1/chat，由写作模型生成真实回复——
 *    对话始终基于当前所选功能的内容展开；回复随历史一并持久化。
 */
import { Bot, MessageCircle, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { sendAssistantMessage } from "@/features/chat/api/chatApi";
import { ConfirmDialog } from "@/shared/components/ui/ConfirmDialog";

/** 会话上下文快照：发送消息时记录"基于哪个条目、条目内容是什么"。 */
export interface ChatContextSnapshot {
  itemId: string;
  itemTitle: string;
  /** 条目内容预览（设定 markdown / 章节正文），截断至 3000 字符。 */
  contentPreview: string;
  /** 原始条目正文按编辑器口径计算的总字数，用于避免把截断预览误当全文字数。 */
  contentWordCount?: number;
  /** 上下文是否因长度限制被截断。 */
  contentTruncated?: boolean;
}

/** 会话消息结构：author 区分发送方，context 记录该消息基于的条目内容快照。 */
interface AssistantMessage {
  id: string;
  author: "创作助手" | "我";
  content: string;
  note?: string;
  context?: ChatContextSnapshot;
}

/** 会话缓存结构版本：v2 起消息携带 context；读取时兼容 v1（裸消息数组）。 */
const CHAT_STORAGE_VERSION = 2;

/** localStorage 会话键：按作品与左侧条目隔离，每个功能条目独享一份缓存。 */
function chatStorageKey(bookId: string, itemId: string) {
  return `ink-agent-studio:editor-chat:${bookId}:${itemId}`;
}

/** 生成消息 id（时间戳 + 随机数，避免同毫秒冲突）。 */
function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 旧版占位回复的标记文案：接入真实模型之前，发送消息后由本地占位逻辑生成并缓存。
 * 升级后历史缓存里可能残留这些消息，读取时自动剔除，避免用户看到过时的
 * "AI 对话生成接口尚未接入"提示。
 */
const LEGACY_PLACEHOLDER_MARKER = "AI 对话生成接口尚未接入编辑器页";

/**
 * 读取该条目的会话缓存。
 * 兼容策略：v2 存 { schemaVersion, messages }；v1 直接存消息数组；
 * 无缓存或格式非法返回 null（由调用方注入欢迎消息）；
 * 读取时过滤掉旧版占位回复（内容含 LEGACY_PLACEHOLDER_MARKER 的消息）。
 */
function loadChatMessages(bookId: string, itemId: string): AssistantMessage[] | null {
  try {
    const raw = localStorage.getItem(chatStorageKey(bookId, itemId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const messages = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { messages?: unknown }).messages)
        ? (parsed as { messages: AssistantMessage[] }).messages
        : null;
    if (!Array.isArray(messages)) return null;
    return messages.filter((message) => !message.content.includes(LEGACY_PLACEHOLDER_MARKER));
  } catch {
    return null;
  }
}

/** 持久化该条目的会话缓存（v2 结构；JSON 序列化失败时静默忽略，本次会话仍在内存中可用）。 */
function saveChatMessages(bookId: string, itemId: string, messages: AssistantMessage[]) {
  try {
    localStorage.setItem(chatStorageKey(bookId, itemId), JSON.stringify({ schemaVersion: CHAT_STORAGE_VERSION, messages }));
  } catch {
    // localStorage 容量或隐私模式受限时忽略，不阻塞对话使用
  }
}

/** 生成该条目的欢迎消息：说明会话绑定与上下文载入状态。 */
function createWelcomeMessage(itemTitle: string, context: ChatContextSnapshot | null): AssistantMessage {
  return {
    id: createMessageId(),
    author: "创作助手",
    content: `已绑定「${itemTitle}」的专属 AI 会话${context?.contentPreview ? "，并已载入该条目的内容作为对话上下文" : ""}。对话记录独立缓存，不会与其他条目串扰。你可以直接输入写作目标、设定问题或修改建议。`,
    note: "内容由 AI 生成，仅供参考。",
    context: context ?? undefined
  };
}

/** 与后端 countWords 口径一致：去除所有空白字符后计数（中文按字计）。 */
function previewWordCount(content: string) {
  return content.replace(/\s+/g, "").length;
}

/** 工具条/消息徽章中的条目内容载入状态文案。 */
function formatContextState(context: ChatContextSnapshot | null) {
  if (!context?.contentPreview) return "未载入条目内容";
  const wordCount = context.contentWordCount ?? previewWordCount(context.contentPreview);
  return context.contentTruncated
    ? `已载入条目内容（正文共 ${wordCount.toLocaleString("zh-CN")} 字，已截取上下文）`
    : `已载入条目内容（${wordCount.toLocaleString("zh-CN")} 字）`;
}

/** AI 对话面板：消息列表与输入框，会话与左侧条目一对一深度绑定，回复由后端写作模型生成。 */
export function AssistantChat({
  bookId,
  itemId,
  itemTitle,
  context
}: {
  bookId: string;
  itemId: string;
  itemTitle: string;
  /** 选中条目的内容上下文快照；由父级在条目切换/内容变化时重新构建。 */
  context: ChatContextSnapshot | null;
}) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  // 切换左侧条目（bookId/itemId 变化）时加载该条目的专属会话，输入框与错误同步清空
  useEffect(() => {
    setMessages(loadChatMessages(bookId, itemId) ?? [createWelcomeMessage(itemTitle, context)]);
    setDraft("");
    setSendError("");
  }, [bookId, itemId, itemTitle]);

  // 新消息后滚动到底部，保证最新对话可见
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, sending]);

  /**
   * 发送消息：把当前条目内容快照与历史消息提交后端 /api/v1/chat，
   * 由写作模型生成回复后追加并持久化；历史消息保留发送时的上下文，不被后续切换污染。
   * 失败时保留用户消息并展示错误（模型未配置/密钥缺失等），可修改后重发。
   */
  async function sendMessage() {
    const content = draft.trim();
    if (!content || sending) return;
    const userMessage: AssistantMessage = {
      id: createMessageId(),
      author: "我",
      content,
      context: context ?? undefined
    };
    const pending = [...messages, userMessage];
    setMessages(pending);
    setDraft("");
    setSendError("");
    setSending(true);
    try {
      const reply = await sendAssistantMessage({
        itemTitle: context?.itemTitle ?? itemTitle,
        context: context?.contentPreview ?? "",
        messages: pending.map((message) => ({ author: message.author, content: message.content }))
      });
      const next = [
        ...pending,
        { id: createMessageId(), author: "创作助手" as const, content: reply.reply, note: `由 ${reply.model} 生成，内容仅供参考。` }
      ];
      setMessages(next);
      saveChatMessages(bookId, itemId, next);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "未知错误");
    } finally {
      setSending(false);
    }
  }

  /** 清空该条目的专属会话：删除缓存并重置为欢迎消息（由项目样式确认弹窗二次确认）。 */
  function clearSession() {
    try {
      localStorage.removeItem(chatStorageKey(bookId, itemId));
    } catch {
      // 忽略移除失败，仅重置内存中的会话
    }
    setMessages([createWelcomeMessage(itemTitle, context)]);
    setSendError("");
  }

  return (
    <div className="novel-assistant-chat">
      <div className="novel-assistant-tools" aria-label="AI 对话工具">
        <span className="novel-assistant-binding" title={`当前会话绑定：${itemTitle}`}>
          <Bot size={15} />
          <span>绑定：{itemTitle}</span>
          <em className="novel-assistant-binding-state">{formatContextState(context)}</em>
        </span>
        <button
          className="novel-assistant-clear"
          type="button"
          onClick={() => setConfirmClearOpen(true)}
          title="清空该条目的专属会话"
        >
          <RotateCcw size={13} />
          <span>清空会话</span>
        </button>
      </div>

      <ConfirmDialog
        open={confirmClearOpen}
        title="清空 AI 会话"
        message={`确定清空「${itemTitle}」的 AI 会话记录？该条目的对话缓存将被删除，此操作不可恢复。`}
        confirmLabel="清空会话"
        cancelLabel="取消"
        danger
        onConfirm={() => {
          clearSession();
          setConfirmClearOpen(false);
        }}
        onCancel={() => setConfirmClearOpen(false)}
      />

      <div className="novel-assistant-messages" ref={listRef}>
        {messages.map((message) => (
          <article className={`novel-assistant-message${message.author === "我" ? " user" : ""}`} key={message.id}>
            <div className="novel-assistant-avatar">{message.author === "我" ? <MessageCircle size={15} /> : <Bot size={15} />}</div>
            <div>
              <strong>
                {message.author}
                {message.context?.contentPreview ? (
                  <em className="novel-assistant-context-badge">基于「{message.context.itemTitle}」</em>
                ) : null}
              </strong>
              <p>{message.content}</p>
              {message.note ? <small>{message.note}</small> : null}
            </div>
          </article>
        ))}
        {sending ? (
          <article className="novel-assistant-message">
            <div className="novel-assistant-avatar"><Bot size={15} /></div>
            <div>
              <strong>创作助手</strong>
              <p>正在思考...</p>
            </div>
          </article>
        ) : null}
        {sendError ? (
          <div className="novel-assistant-send-error">
            <strong>发送失败</strong>
            <span>{sendError}</span>
            <small>可修改消息后重新发送；若为模型未配置或密钥缺失，请到「模型设置」中配置写作模型。</small>
          </div>
        ) : null}
      </div>

      <div className="novel-assistant-input">
        <div>
          <MessageCircle size={14} />
          <span>AI对话</span>
          <small>{draft.length}/50000 字</small>
        </div>
        <textarea
          value={draft}
          disabled={sending}
          placeholder="输入写作目标、章节动作或设定问题。按 Enter 发送，Shift + Enter 换行。"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void sendMessage();
            }
          }}
        />
      </div>
    </div>
  );
}
