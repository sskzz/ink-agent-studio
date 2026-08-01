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

export interface BookCharacter {
  id: string;
  name: string;
  role: "主要" | "次要";
  identity: string;
  markdown: string;
}

export interface CoreFile {
  id: string;
  title: string;
  fileName: string;
  summary: string;
  markdown: string;
}

export interface BookEntity {
  id: string;
  entityType: "character" | "faction" | "location" | "item";
  name: string;
  role: string;
  description: string;
  markdown: string;
}

export interface BookInitialization {
  runId: string | null;
  status: "queued" | "running" | "cancelling" | "cancelled" | "completed" | "failed" | "interrupted";
  stage: string | null;
  error: string | null;
}

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

export interface DetailDocument {
  title: string;
  subtitle: string;
  markdown: string;
}
