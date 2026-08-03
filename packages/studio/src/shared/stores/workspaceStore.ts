/**
 * 全局工作区 UI 状态：当前选中作品、侧边栏折叠与右侧面板开关。
 * 跨页面共享的轻量交互状态放在这里，避免通过路由参数传递。
 */
import { create } from "zustand";

/** 工作区状态切片：activeBookId 由作品库页写入，编辑器页读取以定位当前作品。 */
interface WorkspaceState {
  activeBookId: string | null;
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  setActiveBookId: (bookId: string | null) => void;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
}

/**
 * 工作区 UI 状态 store：纯前端状态，不持久化。
 * 侧边栏折叠状态为会话级记忆，刷新后回到默认展开。
 */
export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeBookId: null,
  sidebarCollapsed: false,
  rightPanelOpen: true,
  setActiveBookId: (bookId) => set({ activeBookId: bookId }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen }))
}));
