import { create } from "zustand";

interface WorkspaceState {
  activeBookId: string | null;
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  setActiveBookId: (bookId: string | null) => void;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeBookId: null,
  sidebarCollapsed: false,
  rightPanelOpen: true,
  setActiveBookId: (bookId) => set({ activeBookId: bookId }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen }))
}));
