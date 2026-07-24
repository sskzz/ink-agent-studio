import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowUp,
  BookOpenText,
  Bot,
  ChevronDown,
  Feather,
  FileText,
  FolderOpen,
  Lightbulb,
  ListTree,
  Network,
  Paperclip,
  RefreshCw,
  Sparkles,
  SpellCheck2,
  UsersRound
} from "lucide-react";
import "./DashboardPage.css";

const quickActions = [
  { label: "续写章节", icon: BookOpenText, prompt: "续写《雾港来信》第 18 章，保持悬疑节奏和冷静克制的叙事风格。" },
  { label: "情节推演", icon: ListTree, prompt: "推演当前剧情接下来的三种发展方向，并说明各自的冲突与伏笔。" },
  { label: "人物小传", icon: UsersRound, prompt: "根据已有设定，为主要人物生成一份包含动机、秘密与成长弧的人物小传。" },
  { label: "构建设定", icon: Network, prompt: "梳理当前作品的世界观设定，并找出可能存在的逻辑缺口。" },
  { label: "风格润色", icon: Feather, prompt: "润色我接下来粘贴的段落，保留原意，让语言更自然、更有画面感。" },
  { label: "一致性检查", icon: SpellCheck2, prompt: "检查当前章节的人物、时间线与世界设定是否一致。" }
] as const;

const inspirations = [
  "写一个发生在凌晨末班地铁上的悬疑开场",
  "设计一位只能记住未来、却忘记过去的人物",
  "把一场普通重逢写出‘有人在说谎’的感觉"
] as const;

export function DashboardPage() {
  const [prompt, setPrompt] = useState("");
  const navigate = useNavigate();

  const startWriting = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = prompt.trim();
    if (!content) return;
    navigate("/editor", { state: { prompt: content } });
  };

  return (
    <div className="page dashboard-workbench">
      <div className="portal-writing-ambient" aria-hidden="true">
        {Array.from({ length: 7 }, (_, index) => <span key={index} />)}
      </div>

      <Link className="portal-mode-pill" to="/models">
        <Sparkles size={14} />
        本地创作 · 隐私优先
      </Link>

      <main className="portal-center">
        <div className="portal-brand" aria-label="Ink Agent 创作工作台">
          <div className="portal-wordmark">
            <strong>INK</strong>
            <span className="portal-brand-mark">
              <Feather size={22} strokeWidth={1.8} />
              <i />
            </span>
            <strong>AGENT</strong>
          </div>
          <p>把一个念头，写成完整故事</p>
        </div>

        <form className="portal-composer-shell" onSubmit={startWriting}>
          <div className="portal-composer">
            <textarea
              aria-label="输入创作任务"
              placeholder="输入创作任务，或按“/”唤起写作技能"
              rows={3}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />

            <div className="portal-composer-toolbar">
              <button aria-label="添加参考资料" className="portal-icon-button" type="button">
                <Paperclip size={19} />
              </button>
              <span className="portal-submit-hint">Ctrl Enter 发送</span>
              <button className="portal-depth-button" type="button">
                深度创作
                <ChevronDown size={14} />
              </button>
              <button
                aria-label="开始创作"
                className="portal-submit-button"
                disabled={!prompt.trim()}
                type="submit"
              >
                <ArrowUp size={19} />
              </button>
            </div>
          </div>

          <Link className="portal-project-picker" to="/workspace">
            <FolderOpen size={16} />
            <span>选择作品</span>
            <ChevronDown size={14} />
          </Link>
        </form>

        <nav className="portal-quick-actions" aria-label="写作快捷能力">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button key={action.label} type="button" onClick={() => setPrompt(action.prompt)}>
                <Icon size={15} />
                {action.label}
              </button>
            );
          })}
        </nav>
      </main>

      <section className="inspiration-dock" aria-label="探索写作灵感">
        <div className="inspiration-dock-head">
          <div>
            <Lightbulb size={17} />
            <span>探索灵感</span>
          </div>
          <span className="inspiration-dock-tip">悬停探索 <ChevronDown size={15} /></span>
        </div>
        <div className="inspiration-list">
          {inspirations.map((idea) => (
            <button key={idea} type="button" onClick={() => setPrompt(idea)}>
              <FileText size={14} />
              <span>{idea}</span>
            </button>
          ))}
          <button aria-label="换一组灵感" className="inspiration-refresh" type="button">
            <RefreshCw size={15} />
          </button>
        </div>
      </section>
    </div>
  );
}
