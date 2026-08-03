/**
 * 作品库页面领域类型：新建草稿、作品详情、角色/实体/核心文件与初始化状态。
 * 与 shared/api/workspaceApi 的 DTO 对应，页面组件只消费本文件中的类型。
 */

/** 新建作品表单草稿：world 文件内容随表单一并提交。 */
export interface BookDraft {
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

/** 作品角色：主要/次要决定角色卡徽章样式，markdown 为可编辑的角色设定正文。 */
export interface BookCharacter {
  id: string;
  name: string;
  role: "主要" | "次要";
  identity: string;
  markdown: string;
}

/** 作品核心文件（梗概等）：摘要用于列表展示，markdown 用于详情渲染。 */
export interface CoreFile {
  id: string;
  title: string;
  fileName: string;
  summary: string;
  markdown: string;
}

/** 作品实体（阵营/地点/物品）：与角色同构渲染，entityType 决定分组归属。 */
export interface BookEntity {
  id: string;
  entityType: "character" | "faction" | "location" | "item";
  name: string;
  role: string;
  description: string;
  markdown: string;
}

/** 作品初始化任务状态：详情页据此渲染进度条 / 失败重试入口。 */
export interface BookInitialization {
  runId: string | null;
  status: "queued" | "running" | "cancelling" | "cancelled" | "completed" | "failed" | "interrupted";
  stage: string | null;
  error: string | null;
}

/** 作品详情（页面版）：属性、进度、角色与实体分组、核心文件与世界观。 */
export interface BookDetail {
  id: string;
  title: string;
  genre: string;
  status: string;
  updatedAt: string;
  brief: string;
  writingStyleId: string;
  writingStyleVersionId: string;
  initialization: BookInitialization | null;
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
  characters: BookCharacter[];
  factions: BookEntity[];
  locations: BookEntity[];
  items: BookEntity[];
  coreFiles: CoreFile[];
  worldview: CoreFile;
}

/** 详情文档：标题 + 副标题 + markdown 正文，用于详情弹层中的文档阅读。 */
export interface DetailDocument {
  title: string;
  subtitle: string;
  markdown: string;
}
