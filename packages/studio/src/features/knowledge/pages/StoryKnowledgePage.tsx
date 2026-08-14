import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpenCheck,
  BrainCircuit,
  CheckCircle2,
  CircleAlert,
  GitBranch,
  Network,
  RefreshCw,
  ScrollText,
  Sparkles,
  UserRoundSearch
} from "lucide-react";
import { Badge } from "@/shared/components/ui/Badge";
import { PageHeader } from "@/shared/components/ui/PageHeader";
import { BackfillReviewPanel } from "@/features/knowledge/components/BackfillReviewPanel";
import { listWorkspaceBookDetails } from "@/shared/api/workspaceApi";
import { getRun } from "@/features/runs/api/runsApi";
import {
  generateStoryPlanBatch,
  getLegacyKnowledgeBackfill,
  getStoryPlan,
  getWorldRules,
  listCharacters,
  listForeshadowing,
  proposeLegacyKnowledgeBackfill,
  applyLegacyKnowledgeBackfill,
  previewLegacyKnowledgeBackfillApply,
  reviewLegacyKnowledgeBackfillItem,
  reviewWorldRuleProposal,
  updateStoryPlanMainLine,
  updateStoryPlanVolume,
  reauditStoryPlanBatch,
  upsertLockedTerm,
  deleteLockedTerm,
  upsertStoryPlanChapter,
  deleteStoryPlanChapter,
  upsertWorldRule,
  archiveWorldRule,
  upsertForeshadowing,
  advanceForeshadowing,
  archiveForeshadowing,
  updateCharacterProfile,
  type CharacterEntity,
  type CharacterProfile,
  type ForeshadowingItem,
  type StoryPlan,
  type WorldRule,
  type WorldRuleRegistry
} from "@/features/knowledge/api/storyKnowledgeApi";

type KnowledgeTab = "outline" | "characters" | "world" | "foreshadowing";

const tabs: Array<{ id: KnowledgeTab; label: string; icon: typeof ScrollText }> = [
  { id: "outline", label: "三层大纲", icon: ScrollText },
  { id: "characters", label: "人物五层档案", icon: UserRoundSearch },
  { id: "world", label: "世界规则", icon: Network },
  { id: "foreshadowing", label: "伏笔生命周期", icon: GitBranch }
];

const terminalStatuses = new Set(["completed", "failed", "cancelled", "interrupted"]);

export function StoryKnowledgePage() {
  const queryClient = useQueryClient();
  const [bookId, setBookId] = useState("");
  const [tab, setTab] = useState<KnowledgeTab>("outline");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const booksQuery = useQuery({ queryKey: ["workspace-books", "knowledge"], queryFn: listWorkspaceBookDetails });
  const books = booksQuery.data ?? [];

  useEffect(() => {
    if (!bookId && books[0]) setBookId(books[0].id);
    if (bookId && books.length > 0 && !books.some((book) => book.id === bookId)) setBookId(books[0].id);
  }, [bookId, books]);

  const storyPlanQuery = useQuery({
    queryKey: ["story-plan", bookId],
    queryFn: () => getStoryPlan(bookId),
    enabled: Boolean(bookId),
    retry: false
  });
  const charactersQuery = useQuery({
    queryKey: ["knowledge-characters", bookId],
    queryFn: () => listCharacters(bookId),
    enabled: Boolean(bookId)
  });
  const worldRulesQuery = useQuery({
    queryKey: ["world-rules", bookId],
    queryFn: () => getWorldRules(bookId),
    enabled: Boolean(bookId),
    retry: false
  });
  const foreshadowingQuery = useQuery({
    queryKey: ["foreshadowing", bookId],
    queryFn: () => listForeshadowing(bookId),
    enabled: Boolean(bookId)
  });
  const backfillQuery = useQuery({
    queryKey: ["legacy-knowledge-backfill", bookId],
    queryFn: () => getLegacyKnowledgeBackfill(bookId),
    enabled: Boolean(bookId),
    retry: false
  });
  const runQuery = useQuery({
    queryKey: ["run", activeRunId],
    queryFn: () => getRun(activeRunId!),
    enabled: Boolean(activeRunId),
    refetchInterval: activeRunId ? 1_500 : false
  });
  const backfillPreviewQuery = useQuery({
    queryKey: ["legacy-knowledge-backfill-preview", bookId, backfillQuery.data?.id],
    queryFn: () => previewLegacyKnowledgeBackfillApply(bookId, backfillQuery.data!.id),
    enabled: Boolean(bookId && backfillQuery.data?.status === "proposed"),
    retry: false
  });

  useEffect(() => {
    const run = runQuery.data;
    if (!run || !terminalStatuses.has(run.status)) return;
    if (run.status === "completed") void queryClient.invalidateQueries({ queryKey: ["story-plan", bookId] });
  }, [bookId, queryClient, runQuery.data]);

  useEffect(() => {
    const characters = charactersQuery.data ?? [];
    if (!selectedCharacterId && characters[0]) setSelectedCharacterId(characters[0].id);
    if (selectedCharacterId && !characters.some((item) => item.id === selectedCharacterId)) {
      setSelectedCharacterId(characters[0]?.id ?? null);
    }
  }, [charactersQuery.data, selectedCharacterId]);

  const generateMutation = useMutation({
    mutationFn: (batchNo: number) => generateStoryPlanBatch(bookId, batchNo),
    onSuccess: (accepted) => setActiveRunId(accepted.runId)
  });
  const characterMutation = useMutation({
    mutationFn: ({ character, profile }: { character: CharacterEntity; profile: CharacterProfile }) =>
      updateCharacterProfile(bookId, character, profile),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["knowledge-characters", bookId] })
  });
  const proposalMutation = useMutation({
    mutationFn: ({ proposalId, approved }: { proposalId: string; approved: boolean }) =>
      reviewWorldRuleProposal(bookId, proposalId, approved),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["world-rules", bookId] })
  });
  const backfillProposalMutation = useMutation({
    mutationFn: () => proposeLegacyKnowledgeBackfill(bookId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["legacy-knowledge-backfill", bookId] })
  });
  const backfillApplyMutation = useMutation({
    mutationFn: (proposalId: string) => applyLegacyKnowledgeBackfill(bookId, proposalId),
    onSuccess: () => void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["legacy-knowledge-backfill", bookId] }),
      queryClient.invalidateQueries({ queryKey: ["story-plan", bookId] }),
      queryClient.invalidateQueries({ queryKey: ["world-rules", bookId] }),
      queryClient.invalidateQueries({ queryKey: ["knowledge-characters", bookId] })
    ])
  });
  const backfillReviewMutation = useMutation({
    mutationFn: ({ itemKey, input }: { itemKey: string; input: { status: "accepted" | "rejected"; editedValue?: unknown; reason?: string } }) =>
      reviewLegacyKnowledgeBackfillItem(bookId, backfillQuery.data!.id, itemKey, input),
    onSuccess: () => void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["legacy-knowledge-backfill", bookId] }),
      queryClient.invalidateQueries({ queryKey: ["legacy-knowledge-backfill-preview", bookId] })
    ])
  });
  const outlineMutation = useMutation({
    mutationFn: (mainLine: string) => updateStoryPlanMainLine(bookId, mainLine),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["story-plan", bookId] })
  });
  const volumeMutation = useMutation({
    mutationFn: (volume: StoryPlan["volumes"][number]) => updateStoryPlanVolume(bookId, volume),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["story-plan", bookId] })
  });
  const reauditMutation = useMutation({
    mutationFn: (batchNo: number) => reauditStoryPlanBatch(bookId, batchNo),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["story-plan", bookId] })
  });
  const termMutation = useMutation({
    mutationFn: ({ term, exists }: { term: StoryPlan["terms"][number]; exists: boolean }) => upsertLockedTerm(bookId, term, exists),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["story-plan", bookId] })
  });
  const termDeleteMutation = useMutation({
    mutationFn: (termId: string) => deleteLockedTerm(bookId, termId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["story-plan", bookId] })
  });
  const planChapterMutation = useMutation({
    mutationFn: (chapter: StoryPlan["chapters"][number]) => upsertStoryPlanChapter(bookId, chapter),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["story-plan", bookId] })
  });
  const planChapterDeleteMutation = useMutation({
    mutationFn: (chapterNo: number) => deleteStoryPlanChapter(bookId, chapterNo),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["story-plan", bookId] })
  });
  const worldRuleMutation = useMutation({
    mutationFn: ({ rule, exists }: { rule: WorldRule; exists: boolean }) => upsertWorldRule(bookId, rule, exists),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["world-rules", bookId] })
  });
  const worldRuleArchiveMutation = useMutation({
    mutationFn: (ruleId: string) => archiveWorldRule(bookId, ruleId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["world-rules", bookId] })
  });
  const foreshadowingMutation = useMutation({
    mutationFn: ({ item, exists }: { item: ForeshadowingItem; exists: boolean }) => upsertForeshadowing(bookId, item, exists),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["foreshadowing", bookId] })
  });
  const foreshadowingAdvanceMutation = useMutation({
    mutationFn: ({ id, status, lastAdvancedChapter }: { id: string; status: ForeshadowingItem["status"]; lastAdvancedChapter?: number | null }) =>
      advanceForeshadowing(bookId, id, status, lastAdvancedChapter),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["foreshadowing", bookId] })
  });
  const foreshadowingArchiveMutation = useMutation({
    mutationFn: (id: string) => archiveForeshadowing(bookId, id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["foreshadowing", bookId] })
  });

  const selectedBook = books.find((book) => book.id === bookId) ?? null;
  const selectedCharacter = (charactersQuery.data ?? []).find((item) => item.id === selectedCharacterId) ?? null;
  const activeRun = runQuery.data;

  return (
    <div className="page story-knowledge-page">
      <PageHeader
        eyebrow="Story Knowledge"
        title="作品知识系统"
        description="让大纲、人物、世界规则与伏笔进入同一套可审计约束链。"
        actions={
          <div className="knowledge-header-actions">
            <select aria-label="选择作品" value={bookId} onChange={(event) => setBookId(event.target.value)}>
              {books.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}
            </select>
            <button
              className="ghost-button"
              type="button"
              onClick={() => void Promise.all([
                storyPlanQuery.refetch(), charactersQuery.refetch(), worldRulesQuery.refetch(), foreshadowingQuery.refetch()
              ])}
            >
              <RefreshCw size={15} /> 刷新
            </button>
          </div>
        }
      />

      {booksQuery.isLoading ? <div className="knowledge-empty">正在读取作品库…</div> : null}
      {!booksQuery.isLoading && books.length === 0 ? <div className="knowledge-empty">请先在作品库创建作品。</div> : null}
      {selectedBook ? (
        <>
          <section className="knowledge-overview">
            <article><BookOpenCheck size={18} /><span>作品</span><strong>{selectedBook.title}</strong></article>
            <article><ScrollText size={18} /><span>章纲</span><strong>{storyPlanQuery.data?.chapters.length ?? 0} / {storyPlanQuery.data?.plannedChapterCount ?? selectedBook.progress.plannedChapters}</strong></article>
            <article><UserRoundSearch size={18} /><span>人物档案</span><strong>{charactersQuery.data?.length ?? 0}</strong></article>
            <article><BrainCircuit size={18} /><span>有效规则</span><strong>{worldRulesQuery.data?.rules.filter((item) => item.status === "active").length ?? 0}</strong></article>
            <article><GitBranch size={18} /><span>活动伏笔</span><strong>{foreshadowingQuery.data?.filter((item) => !["resolved", "archived"].includes(item.status)).length ?? 0}</strong></article>
          </section>

          {backfillQuery.data ? (
            <BackfillReviewPanel
              proposal={backfillQuery.data}
              preview={backfillPreviewQuery.data ?? null}
              busy={backfillApplyMutation.isPending || backfillReviewMutation.isPending}
              error={backfillApplyMutation.isError || backfillReviewMutation.isError ? String(backfillApplyMutation.error ?? backfillReviewMutation.error) : ""}
              onReview={(itemKey, input) => backfillReviewMutation.mutate({ itemKey, input })}
              onApply={() => backfillApplyMutation.mutate(backfillQuery.data!.id)}
            />
          ) : (
            <section className="knowledge-backfill-strip">
              <div><strong>旧作品提案式回填</strong><span>预览只生成独立提案，不覆盖现有知识。</span></div>
              <button className="ghost-button" disabled={backfillProposalMutation.isPending} type="button" onClick={() => backfillProposalMutation.mutate()}>
                <Sparkles size={14} /> {backfillProposalMutation.isPending ? "正在生成提案…" : "生成回填提案"}
              </button>
              {backfillProposalMutation.isError ? <small className="knowledge-inline-error">{String(backfillProposalMutation.error)}</small> : null}
            </section>
          )}

          <nav className="knowledge-tabs" aria-label="作品知识分类">
            {tabs.map((item) => {
              const Icon = item.icon;
              return (
                <button className={tab === item.id ? "active" : ""} key={item.id} type="button" onClick={() => setTab(item.id)}>
                  <Icon size={16} /> {item.label}
                </button>
              );
            })}
          </nav>

          {activeRun ? (
            <div className={`knowledge-run-strip status-${activeRun.status}`}>
              {activeRun.status === "completed" ? <CheckCircle2 size={17} /> : <Sparkles size={17} />}
              <strong>章纲 Run：{runStatusLabel(activeRun.status)}</strong>
              <span>{activeRun.currentStage ?? "等待调度"}</span>
              {activeRun.error ? <small>{JSON.stringify(activeRun.error)}</small> : null}
            </div>
          ) : null}

          {tab === "outline" ? (
            <OutlinePanel
              plan={storyPlanQuery.data ?? null}
              loading={storyPlanQuery.isLoading}
              error={storyPlanQuery.isError ? String(storyPlanQuery.error) : ""}
              generating={generateMutation.isPending || Boolean(activeRun && !terminalStatuses.has(activeRun.status))}
              generationError={generateMutation.isError ? String(generateMutation.error) : ""}
              onGenerate={(batchNo) => generateMutation.mutate(batchNo)}
              onSaveMainLine={(mainLine) => outlineMutation.mutate(mainLine)}
              onSaveVolume={(volume) => volumeMutation.mutate(volume)}
              onReaudit={(batchNo) => reauditMutation.mutate(batchNo)}
              onSaveTerm={(term, exists) => termMutation.mutate({ term, exists })}
              onDeleteTerm={(termId) => termDeleteMutation.mutate(termId)}
              onSaveChapter={(chapter) => planChapterMutation.mutate(chapter)}
              onDeleteChapter={(chapterNo) => planChapterDeleteMutation.mutate(chapterNo)}
            />
          ) : null}
          {tab === "characters" ? (
            <CharactersPanel
              characters={charactersQuery.data ?? []}
              selected={selectedCharacter}
              selectedId={selectedCharacterId}
              loading={charactersQuery.isLoading}
              saving={characterMutation.isPending}
              error={characterMutation.isError ? String(characterMutation.error) : ""}
              onSelect={setSelectedCharacterId}
              onSave={(character, profile) => characterMutation.mutate({ character, profile })}
            />
          ) : null}
          {tab === "world" ? (
            <WorldRulesPanel
              registry={worldRulesQuery.data ?? null}
              loading={worldRulesQuery.isLoading}
              error={worldRulesQuery.isError ? String(worldRulesQuery.error) : proposalMutation.isError ? String(proposalMutation.error) : ""}
              reviewing={proposalMutation.isPending}
              onReview={(proposalId, approved) => proposalMutation.mutate({ proposalId, approved })}
              mutating={worldRuleMutation.isPending || worldRuleArchiveMutation.isPending}
              onSaveRule={(rule, exists) => worldRuleMutation.mutate({ rule, exists })}
              onArchiveRule={(ruleId) => worldRuleArchiveMutation.mutate(ruleId)}
            />
          ) : null}
          {tab === "foreshadowing" ? (
            <ForeshadowingPanel
              items={foreshadowingQuery.data ?? []}
              loading={foreshadowingQuery.isLoading}
              mutating={foreshadowingMutation.isPending || foreshadowingAdvanceMutation.isPending || foreshadowingArchiveMutation.isPending}
              onSave={(item, exists) => foreshadowingMutation.mutate({ item, exists })}
              onAdvance={(id, status, chapterNo) => foreshadowingAdvanceMutation.mutate({ id, status, lastAdvancedChapter: chapterNo })}
              onArchive={(id) => foreshadowingArchiveMutation.mutate(id)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function OutlinePanel({ plan, loading, error, generating, generationError, onGenerate, onSaveMainLine, onSaveVolume, onReaudit, onSaveTerm, onDeleteTerm, onSaveChapter, onDeleteChapter }: {
  plan: StoryPlan | null;
  loading: boolean;
  error: string;
  generating: boolean;
  generationError: string;
  onGenerate(batchNo: number): void;
  onSaveMainLine(mainLine: string): void;
  onSaveVolume(volume: StoryPlan["volumes"][number]): void;
  onReaudit(batchNo: number): void;
  onSaveTerm(term: StoryPlan["terms"][number], exists: boolean): void;
  onDeleteTerm(termId: string): void;
  onSaveChapter(chapter: StoryPlan["chapters"][number]): void;
  onDeleteChapter(chapterNo: number): void;
}) {
  const [volumeNo, setVolumeNo] = useState(1);
  const [mainLine, setMainLine] = useState(plan?.mainLine ?? "");
  const [volumeDraft, setVolumeDraft] = useState<StoryPlan["volumes"][number] | null>(null);
  const [termDraft, setTermDraft] = useState<StoryPlan["terms"][number]>({ id: "term-new", term: "", aliases: [], category: "custom", locked: true, note: "" });
  const [chapterDraft, setChapterDraft] = useState("");
  useEffect(() => {
    if (plan && !plan.volumes.some((item) => item.volumeNo === volumeNo)) setVolumeNo(plan.volumes[0]?.volumeNo ?? 1);
    setMainLine(plan?.mainLine ?? "");
  }, [plan, volumeNo]);
  if (loading) return <div className="knowledge-empty">正在读取三层大纲…</div>;
  if (!plan) return <div className="knowledge-empty error"><CircleAlert size={20} />{error || "作品尚未完成结构化初始化。"}</div>;
  const volume = plan.volumes.find((item) => item.volumeNo === volumeNo) ?? plan.volumes[0];
  const batches = plan.batches.filter((batch) =>
    batch.chapterRange.start >= volume.chapterRange.start && batch.chapterRange.end <= volume.chapterRange.end
  );
  const chapters = plan.chapters.filter((chapter) => chapter.volumeNo === volume.volumeNo);
  const editingVolume = volumeDraft?.volumeNo === volume.volumeNo ? volumeDraft : volume;
  return (
    <section className="knowledge-panel outline-knowledge-panel">
      <aside className="outline-volume-list">
        <p className="knowledge-section-label">全书骨架</p>
        <textarea className="outline-mainline-editor" value={mainLine} onChange={(event) => setMainLine(event.target.value)} />
        <button className="ghost-button" disabled={!mainLine.trim() || mainLine === plan.mainLine} type="button" onClick={() => onSaveMainLine(mainLine)}>保存主线</button>
        <span>{plan.plannedChapterCount} 章 · {plan.volumes.length} 卷 · {plan.terms.length} 个锁定专名</span>
        {plan.volumes.map((item) => (
          <button className={item.volumeNo === volume.volumeNo ? "active" : ""} key={item.id} type="button" onClick={() => setVolumeNo(item.volumeNo)}>
            <strong>第 {item.volumeNo} 卷 · {item.title}</strong>
            <small>第 {item.chapterRange.start}-{item.chapterRange.end} 章</small>
          </button>
        ))}
      </aside>
      <div className="outline-volume-detail">
        <header>
          <div><p className="knowledge-section-label">卷级规划</p><h3>{volume.title}</h3></div>
          <Badge tone="blue">{chapters.length} / {volume.chapterRange.end - volume.chapterRange.start + 1} 章已批准</Badge>
        </header>
        <div className="volume-contract-grid">
          {(["objective", "conflict", "turningPoint", "climax", "resolution"] as const).map((key) => (
            <label key={key}><span>{({ objective: "目标", conflict: "冲突", turningPoint: "转折", climax: "高潮", resolution: "收束" })[key]}</span><textarea value={editingVolume[key]} onChange={(event) => setVolumeDraft({ ...editingVolume, [key]: event.target.value })} /></label>
          ))}
        </div>
        <button className="primary-button" disabled={!volumeDraft} type="button" onClick={() => { if (volumeDraft) onSaveVolume(volumeDraft); setVolumeDraft(null); }}>保存卷级合同</button>
        <section className="locked-term-editor">
          <header><p className="knowledge-section-label">专名锁定</p><Badge>{plan.terms.length} 项</Badge></header>
          <div className="locked-term-list">{plan.terms.map((term) => <article key={term.id}><strong>{term.term}</strong><small>{term.id} · {term.aliases.join("、") || "无别名"}</small><button className="ghost-button" type="button" onClick={() => setTermDraft(term)}>编辑</button><button className="ghost-button" type="button" onClick={() => onDeleteTerm(term.id)}>删除</button></article>)}</div>
          <div className="knowledge-inline-form"><input aria-label="专名 ID" value={termDraft.id} onChange={(event) => setTermDraft({ ...termDraft, id: event.target.value })} /><input aria-label="锁定专名" value={termDraft.term} onChange={(event) => setTermDraft({ ...termDraft, term: event.target.value })} /><input aria-label="专名别名" placeholder="别名，逗号分隔" value={termDraft.aliases.join(",")} onChange={(event) => setTermDraft({ ...termDraft, aliases: event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean) })} /><button className="primary-button" disabled={!termDraft.id.trim() || !termDraft.term.trim()} type="button" onClick={() => onSaveTerm(termDraft, plan.terms.some((term) => term.id === termDraft.id))}>保存专名</button></div>
        </section>
        {generationError ? <p className="knowledge-inline-error">{generationError}</p> : null}
        <div className="outline-batch-grid">
          {batches.map((batch) => {
            const batchChapters = chapters.filter((chapter) =>
              chapter.chapterNo >= batch.chapterRange.start && chapter.chapterNo <= batch.chapterRange.end
            );
            return (
              <article className="outline-batch-card" key={batch.id}>
                <header>
                  <div><strong>批次 {batch.batchNo}</strong><span>第 {batch.chapterRange.start}-{batch.chapterRange.end} 章</span></div>
                  <Badge tone={batch.status === "approved" ? "sage" : batch.status === "blocked" ? "rose" : "amber"}>{batchStatusLabel(batch.status)}</Badge>
                </header>
                <div className="batch-progress"><span style={{ width: `${batchChapters.length / (batch.chapterRange.end - batch.chapterRange.start + 1) * 100}%` }} /></div>
                <p>{batch.qualityGate ? `修复 ${batch.qualityGate.repairAttempts} 次 · ${batch.qualityGate.warnings.length} 条提示` : "等待生成章级五维细纲"}</p>
                {batch.qualityGate?.blockingIssues.slice(0, 2).map((issue) => <small key={issue}>{issue}</small>)}
                <button className="ghost-button" disabled={generating} type="button" onClick={() => onGenerate(batch.batchNo)}>
                  <Sparkles size={14} /> {batch.status === "approved" ? "重新生成并审核" : "生成并过闸门"}
                </button>
                <button className="ghost-button" type="button" onClick={() => onReaudit(batch.batchNo)}>重新审核</button>
              </article>
            );
          })}
        </div>
        <section className="chapter-json-editor"><p className="knowledge-section-label">章级五维 CRUD</p><textarea placeholder="粘贴单章 StoryPlanChapter JSON，可编辑或新增" value={chapterDraft} onChange={(event) => setChapterDraft(event.target.value)} /><button className="primary-button" disabled={!chapterDraft.trim()} type="button" onClick={() => { try { onSaveChapter(JSON.parse(chapterDraft)); setChapterDraft(""); } catch { /* 后端与输入框共同保留错误现场 */ } }}>校验并保存章纲</button></section>
        {chapters.length > 0 ? <ChapterDimensionList chapters={chapters} onEdit={(chapter) => setChapterDraft(JSON.stringify(chapter, null, 2))} onDelete={onDeleteChapter} /> : null}
      </div>
    </section>
  );
}

function ChapterDimensionList({ chapters, onEdit, onDelete }: { chapters: StoryPlan["chapters"]; onEdit(chapter: StoryPlan["chapters"][number]): void; onDelete(chapterNo: number): void }) {
  const [openChapterNo, setOpenChapterNo] = useState(chapters[0]?.chapterNo ?? 0);
  return (
    <div className="chapter-dimension-list">
      <p className="knowledge-section-label">章级五维合同</p>
      {chapters.map((chapter) => (
        <article className={openChapterNo === chapter.chapterNo ? "open" : ""} key={chapter.chapterNo}>
          <button type="button" onClick={() => setOpenChapterNo((current) => current === chapter.chapterNo ? 0 : chapter.chapterNo)}>
            <span>第 {chapter.chapterNo} 章</span><strong>{chapter.title}</strong><Badge>{chapter.status === "approved" ? "已批准" : chapter.status}</Badge>
          </button>
          <div className="chapter-dimension-actions"><button className="ghost-button" type="button" onClick={() => onEdit(chapter)}>编辑 JSON</button><button className="ghost-button" type="button" onClick={() => onDelete(chapter.chapterNo)}>删除</button></div>
          {openChapterNo === chapter.chapterNo ? (
            <div className="chapter-five-dimensions">
              <section><span>梗概</span><p>{chapter.dimensions.synopsis}</p></section>
              <section><span>角色行为</span>{chapter.dimensions.characterActions.map((item) => <p key={`${item.characterId}-${item.action}`}><b>{item.characterId}</b> · {item.action}</p>)}</section>
              <section><span>场景</span><p>{chapter.dimensions.scenes.join(" → ")}</p></section>
              <section><span>冲突</span><p>{chapter.dimensions.conflicts.join("；")}</p></section>
              <section><span>叙事目标</span><p>{chapter.dimensions.narrativeGoals.join("；")}</p></section>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function CharactersPanel({ characters, selected, selectedId, loading, saving, error, onSelect, onSave }: {
  characters: CharacterEntity[];
  selected: CharacterEntity | null;
  selectedId: string | null;
  loading: boolean;
  saving: boolean;
  error: string;
  onSelect(id: string): void;
  onSave(character: CharacterEntity, profile: CharacterProfile): void;
}) {
  if (loading) return <div className="knowledge-empty">正在读取人物档案…</div>;
  if (characters.length === 0) return <div className="knowledge-empty">当前作品没有角色实体。</div>;
  return (
    <section className="knowledge-panel character-knowledge-panel">
      <aside className="character-list">
        <p className="knowledge-section-label">角色 registry</p>
        {characters.map((character) => (
          <button className={selectedId === character.id ? "active" : ""} key={character.id} type="button" onClick={() => onSelect(character.id)}>
            <UserRoundSearch size={18} /><span><strong>{character.name}</strong><small>{character.role || character.id}</small></span>
          </button>
        ))}
      </aside>
      {selected ? (
        <CharacterProfileEditor
          character={selected}
          characters={characters}
          saving={saving}
          error={error}
          onSave={(profile) => onSave(selected, profile)}
        />
      ) : null}
    </section>
  );
}

function CharacterProfileEditor({ character, characters, saving, error, onSave }: {
  character: CharacterEntity;
  characters: CharacterEntity[];
  saving: boolean;
  error: string;
  onSave(profile: CharacterProfile): void;
}) {
  const [profile, setProfile] = useState<CharacterProfile>(() => cloneProfile(character.attributes.profile));
  useEffect(() => setProfile(cloneProfile(character.attributes.profile)), [character]);
  const setList = (section: "core" | "dialogueDna", key: string, value: string) => {
    setProfile((current) => ({
      ...current,
      [section]: { ...(current[section] as object), [key]: lines(value) }
    } as CharacterProfile));
  };
  const updateMilestone = (index: number, milestone: CharacterProfile["arc"]["milestones"][number]) => {
    setProfile((current) => ({
      ...current,
      arc: { ...current.arc, milestones: current.arc.milestones.map((item, itemIndex) => itemIndex === index ? milestone : item) }
    }));
  };
  const removeMilestone = (index: number) => {
    setProfile((current) => ({
      ...current,
      arc: { ...current.arc, milestones: current.arc.milestones.filter((_, itemIndex) => itemIndex !== index) }
    }));
  };
  const updateRelationship = (index: number, relationship: CharacterProfile["relationships"][number]) => {
    setProfile((current) => ({
      ...current,
      relationships: current.relationships.map((item, itemIndex) => itemIndex === index ? relationship : item)
    }));
  };
  const removeRelationship = (index: number) => {
    setProfile((current) => ({ ...current, relationships: current.relationships.filter((_, itemIndex) => itemIndex !== index) }));
  };
  const availableRelationshipTarget = characters.find((item) =>
    item.id !== character.id && !profile.relationships.some((relationship) => relationship.targetCharacterId === item.id)
  );
  return (
    <div className="character-profile-editor">
      <header><div><p className="knowledge-section-label">五层角色模型</p><h3>{character.name}</h3><span>{character.id}</span></div><button className="primary-button" disabled={saving} type="button" onClick={() => onSave(profile)}>{saving ? "保存中…" : "保存档案"}</button></header>
      {error ? <p className="knowledge-inline-error">{error}</p> : null}
      <div className="profile-layer-grid">
        <fieldset><legend>1 · 基础档案</legend><label>外貌<textarea value={profile.core.appearance} onChange={(event) => setProfile({ ...profile, core: { ...profile.core, appearance: event.target.value } })} /></label><label>性格（每行一项）<textarea value={profile.core.personalityTraits.join("\n")} onChange={(event) => setList("core", "personalityTraits", event.target.value)} /></label><label>动机<textarea value={profile.core.motivations.join("\n")} onChange={(event) => setList("core", "motivations", event.target.value)} /></label><label>禁止行为<textarea value={profile.core.prohibitedActions.join("\n")} onChange={(event) => setList("core", "prohibitedActions", event.target.value)} /></label></fieldset>
        <fieldset>
          <legend>2 · 成长轨迹</legend>
          <label>起点<textarea value={profile.arc.startState} onChange={(event) => setProfile({ ...profile, arc: { ...profile.arc, startState: event.target.value } })} /></label>
          <label>目标<textarea value={profile.arc.targetState} onChange={(event) => setProfile({ ...profile, arc: { ...profile.arc, targetState: event.target.value } })} /></label>
          <div className="profile-repeat-list">
            <div className="profile-repeat-heading"><span>阶段里程碑</span><button className="ghost-button" type="button" onClick={() => setProfile((current) => ({ ...current, arc: { ...current.arc, milestones: [...current.arc.milestones, { chapterRange: { start: 1, end: 1 }, change: "" }] } }))}>新增里程碑</button></div>
            {profile.arc.milestones.map((milestone, index) => (
              <article className="profile-repeat-row milestone-row" key={`${milestone.chapterRange.start}-${milestone.chapterRange.end}-${index}`}>
                <label>起始章<input min={1} max={1000} type="number" value={milestone.chapterRange.start} onChange={(event) => updateMilestone(index, { ...milestone, chapterRange: { ...milestone.chapterRange, start: event.currentTarget.valueAsNumber || 1 } })} /></label>
                <label>结束章<input min={1} max={1000} type="number" value={milestone.chapterRange.end} onChange={(event) => updateMilestone(index, { ...milestone, chapterRange: { ...milestone.chapterRange, end: event.currentTarget.valueAsNumber || 1 } })} /></label>
                <label className="profile-repeat-wide">阶段变化<textarea value={milestone.change} onChange={(event) => updateMilestone(index, { ...milestone, change: event.target.value })} /></label>
                <button className="ghost-button profile-repeat-remove" type="button" onClick={() => removeMilestone(index)}>删除</button>
              </article>
            ))}
            {profile.arc.milestones.length === 0 ? <p>暂无阶段里程碑。</p> : null}
          </div>
        </fieldset>
        <fieldset><legend>3 · 时间线</legend><label>当前状态<textarea value={profile.timeline.currentState} onChange={(event) => setProfile({ ...profile, timeline: { ...profile.timeline, currentState: event.target.value } })} /></label><label>已知历史<textarea value={profile.timeline.knownHistory.join("\n")} onChange={(event) => setProfile({ ...profile, timeline: { ...profile.timeline, knownHistory: lines(event.target.value) } })} /></label></fieldset>
        <fieldset>
          <legend>4 · 关系图谱</legend>
          <div className="profile-repeat-list">
            <div className="profile-repeat-heading"><span>人物关系边</span><button className="ghost-button" disabled={!availableRelationshipTarget} type="button" onClick={() => availableRelationshipTarget && setProfile((current) => ({ ...current, relationships: [...current.relationships, { targetCharacterId: availableRelationshipTarget.id, relation: "", tension: "", allowedDirection: "" }] }))}>新增关系</button></div>
            {profile.relationships.map((relation, index) => (
              <article className="profile-repeat-row relationship-row" key={`${relation.targetCharacterId}-${index}`}>
                <label>目标人物<select value={relation.targetCharacterId} onChange={(event) => updateRelationship(index, { ...relation, targetCharacterId: event.target.value })}>{characters.filter((item) => item.id !== character.id).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></label>
                <label>关系类型<input value={relation.relation} onChange={(event) => updateRelationship(index, { ...relation, relation: event.target.value })} placeholder="盟友、师徒、敌对…" /></label>
                <label>当前张力<textarea value={relation.tension} onChange={(event) => updateRelationship(index, { ...relation, tension: event.target.value })} /></label>
                <label>允许演进方向<textarea value={relation.allowedDirection} onChange={(event) => updateRelationship(index, { ...relation, allowedDirection: event.target.value })} /></label>
                <button className="ghost-button profile-repeat-remove" type="button" onClick={() => removeRelationship(index)}>删除</button>
              </article>
            ))}
            {profile.relationships.length === 0 ? <p>暂无关系边，可从其他人物中新增。</p> : null}
          </div>
        </fieldset>
        <fieldset><legend>5 · 对话 DNA</legend><label>声线<textarea value={profile.dialogueDna.voice} onChange={(event) => setProfile({ ...profile, dialogueDna: { ...profile.dialogueDna, voice: event.target.value } })} /></label><label>句式节奏<textarea value={profile.dialogueDna.sentenceRhythm} onChange={(event) => setProfile({ ...profile, dialogueDna: { ...profile.dialogueDna, sentenceRhythm: event.target.value } })} /></label><label>标志性用语<textarea value={profile.dialogueDna.signaturePhrases.join("\n")} onChange={(event) => setList("dialogueDna", "signaturePhrases", event.target.value)} /></label><label>禁用表达<textarea value={profile.dialogueDna.forbiddenExpressions.join("\n")} onChange={(event) => setList("dialogueDna", "forbiddenExpressions", event.target.value)} /></label></fieldset>
      </div>
    </div>
  );
}

function WorldRulesPanel({ registry, loading, error, reviewing, onReview, mutating, onSaveRule, onArchiveRule }: {
  registry: WorldRuleRegistry | null;
  loading: boolean;
  error: string;
  reviewing: boolean;
  onReview(proposalId: string, approved: boolean): void;
  mutating: boolean;
  onSaveRule(rule: WorldRule, exists: boolean): void;
  onArchiveRule(ruleId: string): void;
}) {
  const emptyRule = (): WorldRule => ({ id: "rule-new", title: "", content: "", category: "setting", mutability: "mutable", prohibitedExpressions: [], status: "active", source: "user", sourceChapterNo: null, evidence: "用户维护", updatedAt: new Date().toISOString() });
  const [draft, setDraft] = useState<WorldRule>(emptyRule);
  if (loading) return <div className="knowledge-empty">正在读取世界规则库…</div>;
  if (!registry) return <div className="knowledge-empty error">{error || "作品尚未生成世界规则库。"}</div>;
  const activeRules = registry.rules.filter((rule) => rule.status === "active");
  const proposals = registry.proposals.filter((proposal) => proposal.status === "proposed");
  return (
    <section className="knowledge-panel world-rules-panel">
      {error ? <p className="knowledge-inline-error">{error}</p> : null}
      <div className="world-rule-column"><header><p className="knowledge-section-label">有效规则</p><Badge>{activeRules.length} 条</Badge></header><div className="knowledge-inline-form vertical"><input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} placeholder="规则 ID" /><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="标题" /><textarea value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="规则内容" /><select value={draft.mutability} onChange={(event) => setDraft({ ...draft, mutability: event.target.value as WorldRule["mutability"] })}><option value="immutable">不可变</option><option value="mutable">可演进</option></select><textarea value={draft.prohibitedExpressions.join("\n")} onChange={(event) => setDraft({ ...draft, prohibitedExpressions: lines(event.target.value) })} placeholder="显式禁用表达，每行一条" /><button className="primary-button" disabled={mutating || !draft.id.trim() || !draft.title.trim() || !draft.content.trim()} type="button" onClick={() => { onSaveRule(draft, registry.rules.some((rule) => rule.id === draft.id)); setDraft(emptyRule()); }}>保存规则</button></div>{activeRules.map((rule) => <article key={rule.id}><div><Badge tone={rule.mutability === "immutable" ? "rose" : "blue"}>{rule.mutability === "immutable" ? "不可变" : "可演进"}</Badge><small>{rule.category} · {rule.source}</small></div><h3>{rule.title}</h3><p>{rule.content}</p>{rule.prohibitedExpressions.length ? <small>硬审禁用：{rule.prohibitedExpressions.join("、")}</small> : null}{rule.evidence ? <blockquote>{rule.evidence}</blockquote> : null}<div><button className="ghost-button" type="button" onClick={() => setDraft(rule)}>编辑</button><button className="ghost-button" disabled={mutating} type="button" onClick={() => onArchiveRule(rule.id)}>归档</button></div></article>)}</div>
      <div className="world-proposal-column"><header><p className="knowledge-section-label">待裁决提案</p><Badge tone={proposals.length ? "amber" : "sage"}>{proposals.length} 条</Badge></header>{proposals.map((proposal) => <article key={proposal.id}><span>第 {proposal.chapterNo} 章 · {proposal.targetRuleId ?? "新增规则"}</span><h3>{proposal.title}</h3><p>{proposal.content}</p><blockquote>{proposal.evidence}</blockquote><div><button className="ghost-button" disabled={reviewing} type="button" onClick={() => onReview(proposal.id, false)}>拒绝</button><button className="primary-button" disabled={reviewing} type="button" onClick={() => onReview(proposal.id, true)}>批准新版本</button></div></article>)}{proposals.length === 0 ? <div className="knowledge-empty compact">暂无待审核规则改写。</div> : null}</div>
    </section>
  );
}

function ForeshadowingPanel({ items, loading, mutating, onSave, onAdvance, onArchive }: { items: ForeshadowingItem[]; loading: boolean; mutating: boolean; onSave(item: ForeshadowingItem, exists: boolean): void; onAdvance(id: string, status: ForeshadowingItem["status"], chapterNo?: number | null): void; onArchive(id: string): void }) {
  const [filter, setFilter] = useState<"all" | "short" | "long">("all");
  const emptyItem = (): ForeshadowingItem => ({ id: "hook-new", content: "", relatedEntityIds: [], placement: "待规划", resolution: "待规划", horizon: "short", targetChapterRange: null, status: "planned", lastAdvancedChapter: null, missedCount: 0 });
  const [draft, setDraft] = useState<ForeshadowingItem>(emptyItem);
  const visible = useMemo(() => items.filter((item) => filter === "all" || (item.horizon ?? "short") === filter), [filter, items]);
  if (loading) return <div className="knowledge-empty">正在读取伏笔池…</div>;
  return (
    <section className="knowledge-panel foreshadowing-panel">
      <header><div><p className="knowledge-section-label">生命周期状态机</p><h3>埋设 → 推进 → 预警 → 回收 → 归档</h3></div><div className="foreshadowing-filters">{(["all", "short", "long"] as const).map((item) => <button className={filter === item ? "active" : ""} key={item} type="button" onClick={() => setFilter(item)}>{item === "all" ? "全部" : item === "short" ? "短线" : "长线"}</button>)}</div></header>
      <div className="knowledge-inline-form foreshadowing-editor"><input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} placeholder="伏笔 ID" /><input value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="伏笔内容" /><input value={draft.placement} onChange={(event) => setDraft({ ...draft, placement: event.target.value })} placeholder="投放计划" /><input value={draft.resolution} onChange={(event) => setDraft({ ...draft, resolution: event.target.value })} placeholder="回收计划" /><select value={draft.horizon ?? "short"} onChange={(event) => setDraft({ ...draft, horizon: event.target.value as "short" | "long" })}><option value="short">短线</option><option value="long">长线</option></select><button className="primary-button" disabled={mutating || !draft.id.trim() || !draft.content.trim()} type="button" onClick={() => { onSave(draft, items.some((item) => item.id === draft.id)); setDraft(emptyItem()); }}>保存伏笔</button></div>
      <div className="foreshadowing-grid">{visible.map((item) => <article className={`schedule-${item.scheduleStatus ?? "on_track"}`} key={item.id}><header><Badge tone={(item.horizon ?? "short") === "long" ? "blue" : "sage"}>{(item.horizon ?? "short") === "long" ? "长线" : "短线"}</Badge><Badge tone={item.scheduleStatus === "overdue" ? "rose" : item.scheduleStatus === "due" ? "amber" : "sage"}>{scheduleLabel(item.scheduleStatus)}</Badge></header><h3>{item.content}</h3><div className="foreshadowing-lifecycle">{["planned", "planted", "advancing", "resolving", "resolved", "archived"].map((status) => <button className={status === item.status ? "current" : ""} disabled={mutating || statusIndex(status) < statusIndex(item.status)} type="button" onClick={() => onAdvance(item.id, status as ForeshadowingItem["status"], item.lastAdvancedChapter)} key={status}>{foreshadowingStatusLabel(status)}</button>)}</div><dl><div><dt>投放</dt><dd>{item.placement}</dd></div><div><dt>回收</dt><dd>{item.resolution}</dd></div><div><dt>目标章节</dt><dd>{item.targetChapterRange ? `${item.targetChapterRange.start}-${item.targetChapterRange.end}` : "未结构化"}</dd></div><div><dt>兜底计数</dt><dd>{item.missedCount ?? 0}</dd></div></dl><div><button className="ghost-button" type="button" onClick={() => setDraft(item)}>编辑</button><button className="ghost-button" disabled={mutating || item.status === "archived"} type="button" onClick={() => onArchive(item.id)}>归档</button></div>{(item.missedCount ?? 0) >= 2 && item.scheduleStatus === "overdue" ? <p className="force-recovery"><CircleAlert size={15} /> 已进入强制回收注入</p> : null}</article>)}</div>
      {visible.length === 0 ? <div className="knowledge-empty compact">当前分池暂无伏笔。</div> : null}
    </section>
  );
}

function cloneProfile(profile: CharacterProfile | undefined): CharacterProfile {
  return structuredClone(profile ?? {
    schemaVersion: "character-profile.v1",
    core: { appearance: "", personalityTraits: [], motivations: [], values: [], hardConstraints: [], prohibitedActions: [] },
    arc: { startState: "", targetState: "", milestones: [] },
    timeline: { currentState: "", knownHistory: [] },
    relationships: [],
    dialogueDna: { voice: "", sentenceRhythm: "", signaturePhrases: [], forbiddenExpressions: [], subtextHabits: [] }
  });
}

function lines(value: string) { return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean); }
function runStatusLabel(status: string) { return ({ queued: "排队中", running: "生成中", cancelling: "取消中", completed: "已完成", failed: "失败", cancelled: "已取消", interrupted: "已中断" } as Record<string, string>)[status] ?? status; }
function batchStatusLabel(status: string) { return ({ draft: "待生成", generating: "生成中", reviewing: "审核中", approved: "已批准", blocked: "已阻断" } as Record<string, string>)[status] ?? status; }
function scheduleLabel(status?: string) { return status === "overdue" ? "已逾期" : status === "due" ? "待回收" : "正常"; }
function foreshadowingStatusLabel(status: string) { return ({ planned: "规划", planted: "埋设", advancing: "推进", resolving: "回收", resolved: "完成", archived: "归档" } as Record<string, string>)[status] ?? status; }
function statusIndex(status: string) { return ["planned", "planted", "advancing", "resolving", "resolved", "archived"].indexOf(status); }
