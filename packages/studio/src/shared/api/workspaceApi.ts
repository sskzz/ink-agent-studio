import { apiDelete, apiGet, apiPost } from "@/shared/api/http";

export interface WorkspaceBookDraft {
  title: string;
  genre: string;
  narrationPerspective: string;
  channel: string;
  writingStyleId: string;
  protagonistGender: string;
  protagonistName: string;
  plannedWords: string;
  chapterWords: string;
  brief: string;
  worldFileName: string;
  worldFileContent: string;
}

export interface WorkspaceBookCharacter {
  id: string;
  name: string;
  role: "主要" | "次要";
  identity: string;
  markdown: string;
}

export interface WorkspaceBookEntity {
  id: string;
  entityType: "character" | "faction" | "location" | "item";
  name: string;
  role: string;
  description: string;
  markdown: string;
}

export interface WorkspaceBookInitialization {
  runId: string | null;
  status: "queued" | "running" | "cancelling" | "cancelled" | "completed" | "failed" | "interrupted";
  stage: string | null;
  error: string | null;
}

export interface WorkspaceBookCreationResult {
  book: WorkspaceBookDetail;
  hydrationWarning: string | null;
}

export interface WorkspaceCoreFile {
  id: string;
  title: string;
  fileName: string;
  summary: string;
  markdown: string;
}

export interface WorkspaceBookDetail {
  id: string;
  title: string;
  genre: string;
  status: string;
  updatedAt: string;
  brief: string;
  writingStyleId: string;
  writingStyleVersionId: string;
  initialization: WorkspaceBookInitialization | null;
  attributes: {
    narrationPerspective: string;
    channel: string;
    protagonistGender: string;
    protagonistName: string;
    plannedWords: number;
    chapterWords: number;
    worldFileName: string;
  };
  progress: {
    currentChapter: string;
    writtenWords: number;
    writtenChapters: number;
    plannedChapters: number;
  };
  characters: WorkspaceBookCharacter[];
  factions: WorkspaceBookEntity[];
  locations: WorkspaceBookEntity[];
  items: WorkspaceBookEntity[];
  coreFiles: WorkspaceCoreFile[];
  worldview: WorkspaceCoreFile;
}

interface BackendBookSummary {
  id: string;
}

interface BackendBookFile {
  id: string;
  fileType: string;
  title: string;
  path: string;
  summary: string;
}

interface BackendBookFileContent extends BackendBookFile {
  content: string;
}

interface BackendBookDetail {
  id: string;
  title: string;
  genre: string;
  status: "planning" | "drafting" | "reviewing" | "paused";
  writingStyleId: string | null;
  writingStyleVersionId?: string | null;
  updatedAt: string;
  attributes: {
    narrationPerspective: string;
    channel: string;
    protagonistGender: string;
    protagonistName: string;
    plannedWords: number | null;
    chapterWords: number | null;
    worldFileId: string | null;
  };
  progress: {
    writtenWords: number;
    writtenChapters: number;
    plannedChapters: number | null;
    currentChapterId: string | null;
  };
  coreFiles: BackendBookFile[];
  worldview: BackendBookFile | null;
  initialization?: WorkspaceBookInitialization | null;
}

interface BackendBookEntity {
  id: string;
  entityType: "character" | "faction" | "location" | "item";
  name: string;
  role: string;
  description: string;
}

const statusLabel: Record<BackendBookDetail["status"], string> = {
  planning: "规划中",
  drafting: "写作中",
  reviewing: "审稿中",
  paused: "已暂停"
};

function toPositiveNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value || "暂无更新";
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function createEmptyFile(id: string, title: string): WorkspaceCoreFile {
  return {
    id,
    title,
    fileName: `${id}.md`,
    summary: "暂无内容，后续可由 AI 初始化或手动补充。",
    markdown: `# ${title}\n\n暂无内容。`
  };
}

async function loadFileContent(bookId: string, file: BackendBookFile): Promise<WorkspaceCoreFile> {
  const content = await apiGet<BackendBookFileContent>(`/books/${bookId}/files/${file.id}`);

  return {
    id: file.id,
    title: file.title,
    fileName: file.path,
    summary: file.summary,
    markdown: content.content || `# ${file.title}\n\n暂无内容。`
  };
}

function createEntityMarkdown(entity: BackendBookEntity) {
  return `# ${entity.name}

## 类型
${entity.entityType}

## 定位
${entity.role || "待补充"}

## 描述
${entity.description || "待补充"}
`;
}

async function toWorkspaceBookDetail(detail: BackendBookDetail): Promise<WorkspaceBookDetail> {
  const [coreFiles, worldview, entities] = await Promise.all([
    Promise.all(detail.coreFiles.map((file) => loadFileContent(detail.id, file))),
    detail.worldview ? loadFileContent(detail.id, detail.worldview) : Promise.resolve(createEmptyFile("world", "世界观")),
    apiGet<BackendBookEntity[]>(`/books/${detail.id}/entities`).catch(() => [])
  ]);

  const storyBrief = coreFiles.find((file) => file.id === "brief")?.markdown ?? "";

  return {
    id: detail.id,
    title: detail.title,
    genre: detail.genre,
    status: statusLabel[detail.status],
    updatedAt: formatUpdatedAt(detail.updatedAt),
    brief: storyBrief,
    writingStyleId: detail.writingStyleId ?? "",
    writingStyleVersionId: detail.writingStyleVersionId ?? "",
    initialization: detail.initialization ?? null,
    attributes: {
      narrationPerspective: detail.attributes.narrationPerspective || "AI 自动生成",
      channel: detail.attributes.channel || "AI 自动生成",
      protagonistGender: detail.attributes.protagonistGender || "AI 自动生成",
      protagonistName: detail.attributes.protagonistName || "AI 自动生成",
      plannedWords: detail.attributes.plannedWords ?? 0,
      chapterWords: detail.attributes.chapterWords ?? 0,
      worldFileName: worldview.fileName
    },
    progress: {
      currentChapter: detail.progress.currentChapterId ?? "尚未开始正文写作",
      writtenWords: detail.progress.writtenWords,
      writtenChapters: detail.progress.writtenChapters,
      plannedChapters: detail.progress.plannedChapters ?? 0
    },
    characters: entities.filter((entity) => entity.entityType === "character").map((character) => ({
      id: character.id,
      name: character.name,
      role: character.role.includes("主") ? "主要" : "次要",
      identity: character.role || character.description || "待补充角色定位",
      markdown: createEntityMarkdown(character)
    })),
    factions: mapEntities(entities, "faction"),
    locations: mapEntities(entities, "location"),
    items: mapEntities(entities, "item"),
    coreFiles,
    worldview
  };
}

function toWorkspaceBookDetailWithoutContent(detail: BackendBookDetail): WorkspaceBookDetail {
  const coreFiles = detail.coreFiles.map((file) => ({
    id: file.id,
    title: file.title,
    fileName: file.path,
    summary: file.summary,
    markdown: `# ${file.title}\n\n作品已创建，但文件内容暂时读取失败。请稍后刷新。`
  }));
  const worldview = detail.worldview
    ? {
        id: detail.worldview.id,
        title: detail.worldview.title,
        fileName: detail.worldview.path,
        summary: detail.worldview.summary,
        markdown: `# ${detail.worldview.title}\n\n作品已创建，但世界观内容暂时读取失败。请稍后刷新。`
      }
    : createEmptyFile("world", "世界观");

  return {
    id: detail.id,
    title: detail.title,
    genre: detail.genre,
    status: statusLabel[detail.status],
    updatedAt: formatUpdatedAt(detail.updatedAt),
    brief: coreFiles.find((file) => file.id === "brief")?.markdown ?? "",
    writingStyleId: detail.writingStyleId ?? "",
    writingStyleVersionId: detail.writingStyleVersionId ?? "",
    initialization: detail.initialization ?? null,
    attributes: {
      narrationPerspective: detail.attributes.narrationPerspective || "AI 自动生成",
      channel: detail.attributes.channel || "AI 自动生成",
      protagonistGender: detail.attributes.protagonistGender || "AI 自动生成",
      protagonistName: detail.attributes.protagonistName || "AI 自动生成",
      plannedWords: detail.attributes.plannedWords ?? 0,
      chapterWords: detail.attributes.chapterWords ?? 0,
      worldFileName: worldview.fileName
    },
    progress: {
      currentChapter: detail.progress.currentChapterId ?? "尚未开始正文写作",
      writtenWords: detail.progress.writtenWords,
      writtenChapters: detail.progress.writtenChapters,
      plannedChapters: detail.progress.plannedChapters ?? 0
    },
    characters: [],
    factions: [],
    locations: [],
    items: [],
    coreFiles,
    worldview
  };
}

function mapEntities(entities: BackendBookEntity[], entityType: WorkspaceBookEntity["entityType"]): WorkspaceBookEntity[] {
  return entities.filter((entity) => entity.entityType === entityType).map((entity) => ({
    ...entity,
    markdown: createEntityMarkdown(entity)
  }));
}

export async function listWorkspaceBookDetails(): Promise<WorkspaceBookDetail[]> {
  const summaries = await apiGet<BackendBookSummary[]>("/books");
  const details = await Promise.all(summaries.map((book) => apiGet<BackendBookDetail>(`/books/${book.id}`)));
  return Promise.all(details.map(toWorkspaceBookDetail));
}

export async function getWorkspaceBookDetail(bookId: string): Promise<WorkspaceBookDetail> {
  const detail = await apiGet<BackendBookDetail>(`/books/${bookId}`);
  return toWorkspaceBookDetail(detail);
}

export async function getWorkspaceBookInitialization(bookId: string): Promise<WorkspaceBookInitialization | null> {
  const detail = await apiGet<Pick<BackendBookDetail, "initialization">>(`/books/${bookId}`);
  return detail.initialization ?? null;
}

export async function createWorkspaceBook(draft: WorkspaceBookDraft): Promise<WorkspaceBookCreationResult> {
  const detail = await apiPost<BackendBookDetail>("/books", {
    title: draft.title,
    genre: draft.genre,
    narrationPerspective: draft.narrationPerspective,
    channel: draft.channel,
    writingStyleId: draft.writingStyleId || null,
    protagonistGender: draft.protagonistGender,
    protagonistName: draft.protagonistName,
    plannedWords: toPositiveNumber(draft.plannedWords),
    chapterWords: toPositiveNumber(draft.chapterWords),
    brief: draft.brief,
    worldFileName: draft.worldFileName,
    worldFileContent: draft.worldFileContent
  });

  try {
    return { book: await toWorkspaceBookDetail(detail), hydrationWarning: null };
  } catch (error) {
    return {
      book: toWorkspaceBookDetailWithoutContent(detail),
      hydrationWarning: error instanceof Error ? error.message : "作品详情读取失败"
    };
  }
}

export async function retryWorkspaceBookInitialization(bookId: string) {
  return apiPost<WorkspaceBookInitialization & { reused: boolean }>(`/books/${bookId}/initialize`);
}

export async function upgradeWorkspaceBookWritingStyleVersion(bookId: string, versionId?: string) {
  const detail = await apiPost<BackendBookDetail>(`/books/${bookId}/writing-style/upgrade`, {
    versionId: versionId ?? null
  });
  return toWorkspaceBookDetail(detail);
}

export async function deleteWorkspaceBook(bookId: string): Promise<void> {
  await apiDelete(`/books/${bookId}`);
}
