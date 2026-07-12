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

function createCharacterMarkdown(entity: BackendBookEntity) {
  return `# ${entity.name}

## 定位
${entity.role || "待补充"}

## 描述
${entity.description || "待补充"}
`;
}

async function toWorkspaceBookDetail(detail: BackendBookDetail): Promise<WorkspaceBookDetail> {
  const [coreFiles, worldview, characters] = await Promise.all([
    Promise.all(detail.coreFiles.map((file) => loadFileContent(detail.id, file))),
    detail.worldview ? loadFileContent(detail.id, detail.worldview) : Promise.resolve(createEmptyFile("world", "世界观")),
    apiGet<BackendBookEntity[]>(`/books/${detail.id}/entities?type=character`).catch(() => [])
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
    characters: characters.map((character) => ({
      id: character.id,
      name: character.name,
      role: character.role.includes("主") ? "主要" : "次要",
      identity: character.role || character.description || "待补充角色定位",
      markdown: createCharacterMarkdown(character)
    })),
    coreFiles,
    worldview
  };
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

export async function createWorkspaceBook(draft: WorkspaceBookDraft): Promise<WorkspaceBookDetail> {
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

  return toWorkspaceBookDetail(detail);
}

export async function deleteWorkspaceBook(bookId: string): Promise<void> {
  await apiDelete(`/books/${bookId}`);
}
