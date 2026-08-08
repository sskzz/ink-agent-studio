/**
 * 故事线面板：编辑器左侧功能栏底部的剧情看板。
 * 展示作品的：主体剧情进度、阶段剧情进度、当前章节在主体/阶段剧情中的位置、
 * 当前章节所埋短期伏笔与各角色状态。数据来自 GET /books/:bookId/storyline。
 */
import { Activity, Flag, Layers, MapPin, RefreshCw, UsersRound, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { getBookStoryline, type StorylineData } from "@/features/storyline/api/storylineApi";

/** 伏笔状态中文标签。 */
const foreshadowingLabels: Record<string, string> = {
  planned: "规划中",
  planted: "已植入",
  resolving: "回收中",
  resolved: "已回收"
};

export function StorylinePanel({ bookId }: { bookId: string }) {
  const [storyline, setStoryline] = useState<StorylineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setStoryline(await getBookStoryline(bookId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "故事线读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  return (
    <section className="novel-storyline" aria-label="故事线">
      <div className="novel-storyline-head">
        <strong>故事线</strong>
        <button type="button" onClick={() => void load()} aria-label="刷新故事线">
          <RefreshCw size={13} />
        </button>
      </div>

      {error ? <p className="novel-storyline-error">{error}</p> : null}
      {loading && !storyline ? <p className="novel-storyline-empty">正在读取剧情进度...</p> : null}
      {storyline ? (
        <div className="novel-storyline-scroll">
          <StorylineSection title="主体剧情进度" icon={Activity}>
            {storyline.mainProgress.length > 0 ? storyline.mainProgress.map((line) => (
              <p className="novel-storyline-line" key={line}>{line}</p>
            )) : <p className="novel-storyline-line muted">暂无进度记录。</p>}
          </StorylineSection>

          <StorylineSection title="阶段剧情进度" icon={Layers}>
            <p className="novel-storyline-line">
              第 {storyline.stageProgress.volume || "?"} 卷 · 第 {storyline.stageProgress.chapterNo || "?"} 章
              （全卷共 {storyline.stageProgress.volumeTotal} 卷 / 共 {storyline.stageProgress.chapterTotal} 章）
            </p>
          </StorylineSection>

          <StorylineSection title="当前章节位置" icon={MapPin}>
            <p className="novel-storyline-line"><em>主体剧情：</em>{storyline.currentPosition.main}</p>
            <p className="novel-storyline-line"><em>阶段剧情：</em>{storyline.currentPosition.stage}</p>
          </StorylineSection>

          <StorylineSection title="本章短期伏笔" icon={Flag}>
            {storyline.shortForeshadowing.length > 0 ? storyline.shortForeshadowing.map((item) => (
              <p className="novel-storyline-line" key={item.id}>
                <strong>{item.id}</strong>
                <span className={`novel-storyline-badge ${item.status}`}>{foreshadowingLabels[item.status] ?? item.status}</span>
                {item.content}
              </p>
            )) : <p className="novel-storyline-line muted">本章暂无未回收伏笔。</p>}
          </StorylineSection>

          <StorylineSection title="角色状态" icon={UsersRound}>
            {storyline.characterStates.length > 0 ? storyline.characterStates.map((character) => (
              <p className="novel-storyline-line" key={character.characterId}>
                <strong>{character.name}</strong>
                {character.state}
              </p>
            )) : <p className="novel-storyline-line muted">暂无角色状态记录。</p>}
          </StorylineSection>
        </div>
      ) : null}
    </section>
  );
}

/** 单个故事线分组：标题 + 图标 + 内容。 */
function StorylineSection({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <section className="novel-storyline-section">
      <div className="novel-storyline-group-head">
        <span><Icon size={13} /></span>
        <strong>{title}</strong>
      </div>
      <div className="novel-storyline-group-body">{children}</div>
    </section>
  );
}