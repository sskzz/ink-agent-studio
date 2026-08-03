/**
 * 作品库 API：作品 CRUD、创建初始化与写作风格版本升级。
 * 负责把后端扁平结构（文件列表 + 实体列表）组装为页面友好的 WorkspaceBookDetail，
 * 并内置“文件内容读取失败”的降级兜底，保证新建后页面仍可浏览。
 */
import { apiDelete, apiGet, apiPost } from "@/shared/api/http";

/** 新建作品表单草稿：world 文件正文一并上传，避免只落文件名导致内容缺失。 */
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

/** 作品角色：主要/次要决定了角色卡片上的徽章样式。 */
export interface WorkspaceBookCharacter {
  id: string;
  name: string;
  role: "主要" | "次要";
  identity: string;
  markdown: string;
}

/** 作品实体（阵营/地点/物品）：与角色共用 markdown 渲染结构。 */
export interface WorkspaceBookEntity {
  id: string;
  entityType: "character" | "faction" | "location" | "item";
  name: string;
  role: string;
  description: string;
  markdown: string;
}

/** 作品初始化任务状态：用于轮询展示 AI 生成世界观/大纲的进度与失败原因。 */
export interface WorkspaceBookInitialization {
  runId: string | null;
  status: "queued" | "running" | "cancelling" | "cancelled" | "completed" | "failed" | "interrupted";
  stage: string | null;
  error: string | null;
}

/** 创建作品结果：hydrationWarning 在详情读取失败时给出提示，页面降级展示。 */
export interface WorkspaceBookCreationResult {
  book: WorkspaceBookDetail;
  hydrationWarning: string | null;
}

/** 作品核心文件（如梗概、世界观）：标题、文件名与 markdown 正文，供详情页渲染。 */
export interface WorkspaceCoreFile {
  id: string;
  title: string;
  fileName: string;
  summary: string;
  markdown: string;
}

/** 作品详情（页面版）：把后端的 id 引用展开为可直接渲染的角色/实体/文件列表。 */
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

/** 后端作品列表接口返回的摘要：当前只需 id，明细按需逐个请求。 */
interface BackendBookSummary {
  id: string;
}

/** 后端文件元信息：path 为磁盘相对路径，正文内容需要再请求一次。 */
interface BackendBookFile {
  id: string;
  fileType: string;
  title: string;
  path: string;
  summary: string;
}

/** 后端文件内容响应：在文件元信息基础上追加 content。 */
interface BackendBookFileContent extends BackendBookFile {
  content: string;
}

/** 后端作品详情：与本地 JSON 文件结构对应，字段粒度偏后端语义。 */
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

/** 作品状态英文值到中文标签的映射，详情页直接展示。 */
const statusLabel: Record<BackendBookDetail["status"], string> = {
  planning: "规划中",
  drafting: "写作中",
  reviewing: "审稿中",
  paused: "已暂停"
};

/** 表单中的字数输入转为正整数；非法或非正数返回 null，避免脏数据入库。 */
function toPositiveNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

/** 后端时间戳格式化为“MM-DD HH:mm”；非法时间戳直接回显原值。 */
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

/** 生成一个带占位内容的空核心文件（如世界观缺失时），保证详情页结构完整。 */
function createEmptyFile(id: string, title: string): WorkspaceCoreFile {
  return {
    id,
    title,
    fileName: `${id}.md`,
    summary: "暂无内容，后续可由 AI 初始化或手动补充。",
    markdown: `# ${title}\n\n暂无内容。`
  };
}

/** 拉取单个核心文件的正文；内容为空时返回占位文本而非空字符串。 */
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

/** 把后端实体字段渲染为 markdown 文档，供详情页的实体区块展示。 */
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

/** 把后端作品详情组装为页面版详情：并行加载核心文件正文、世界观与实体列表。 */
async function toWorkspaceBookDetail(detail: BackendBookDetail): Promise<WorkspaceBookDetail> {
  // 实体列表读取失败时降级为空数组，不阻塞整个详情页渲染。
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

/** 兜底版详情组装：文件正文全部读取失败时仍返回作品框架，避免新建后页面空白。 */
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

/** 按实体类型过滤并补上 markdown 渲染内容，供详情页分组展示。 */
function mapEntities(entities: BackendBookEntity[], entityType: WorkspaceBookEntity["entityType"]): WorkspaceBookEntity[] {
  return entities.filter((entity) => entity.entityType === entityType).map((entity) => ({
    ...entity,
    markdown: createEntityMarkdown(entity)
  }));
}

/** 作品库列表：先取摘要列表，再并发拉取每个作品的完整详情。 */
export async function listWorkspaceBookDetails(): Promise<WorkspaceBookDetail[]> {
  const summaries = await apiGet<BackendBookSummary[]>("/books");
  const details = await Promise.all(summaries.map((book) => apiGet<BackendBookDetail>(`/books/${book.id}`)));
  return Promise.all(details.map(toWorkspaceBookDetail));
}

/** 单个作品详情：作品库与编辑器共用。 */
export async function getWorkspaceBookDetail(bookId: string): Promise<WorkspaceBookDetail> {
  const detail = await apiGet<BackendBookDetail>(`/books/${bookId}`);
  return toWorkspaceBookDetail(detail);
}

/** 只取作品初始化状态：用于页面轮询初始化进度，不下载整份详情。 */
export async function getWorkspaceBookInitialization(bookId: string): Promise<WorkspaceBookInitialization | null> {
  const detail = await apiGet<Pick<BackendBookDetail, "initialization">>(`/books/${bookId}`);
  return detail.initialization ?? null;
}

/** 创建作品：提交草稿后尝试组装完整详情；若文件读取失败则返回降级详情并附 warning。 */
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

  // 详情组装失败不影响创建成功本身，降级返回 + 提示用户稍后刷新。
  try {
    return { book: await toWorkspaceBookDetail(detail), hydrationWarning: null };
  } catch (error) {
    return {
      book: toWorkspaceBookDetailWithoutContent(detail),
      hydrationWarning: error instanceof Error ? error.message : "作品详情读取失败"
    };
  }
}

/** 重试作品初始化（AI 生成世界观等）：reused 表示复用了上次未完成的产物。 */
export async function retryWorkspaceBookInitialization(bookId: string) {
  return apiPost<WorkspaceBookInitialization & { reused: boolean }>(`/books/${bookId}/initialize`);
}

/** 升级作品写作风格版本：versionId 缺省时由后端选用最新版本。 */
export async function upgradeWorkspaceBookWritingStyleVersion(bookId: string, versionId?: string) {
  const detail = await apiPost<BackendBookDetail>(`/books/${bookId}/writing-style/upgrade`, {
    versionId: versionId ?? null
  });
  return toWorkspaceBookDetail(detail);
}

/** 删除作品及其本地文件。 */
export async function deleteWorkspaceBook(bookId: string): Promise<void> {
  await apiDelete(`/books/${bookId}`);
}
