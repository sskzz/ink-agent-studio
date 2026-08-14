/**
 * 主题状态：dark / light 双主题，持久化到 localStorage。
 * 在 store 创建时读取 localStorage 并把 data-theme 写到 <html> 上，
 * 避免首屏闪烁；切换时同步更新属性与存储。
 */
import { create } from "zustand";

/** 支持的主题枚举。 */
export type Theme = "dark" | "light";

/** localStorage 键名。 */
const THEME_STORAGE_KEY = "ink-agent-theme";

/** 当前生效主题，缺省回退到深色。 */
function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const value = window.localStorage.getItem(THEME_STORAGE_KEY);
  return value === "light" || value === "dark" ? value : "dark";
}

/** 把主题写到 <html data-theme> 上，驱动 CSS 变量切换。 */
function applyTheme(theme: Theme) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

/**
 * 主题 store：创建即初始化 data-theme 属性，切换时持久化并同步 DOM。
 * 跨页面共享，避免每个组件各自读取 localStorage。
 */
export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = readStoredTheme();
  applyTheme(initial);

  return {
    theme: initial,
    setTheme: (theme) => {
      applyTheme(theme);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      }
      set({ theme });
    },
    toggleTheme: () => {
      get().setTheme(get().theme === "dark" ? "light" : "dark");
    }
  };
});
