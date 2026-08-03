import { QueryClient } from "@tanstack/react-query";

/**
 * 全局 React Query 客户端。
 * 配置 30s 缓存保鲜、单次重试、失焦不刷新：本地优先产品中数据源主要是磁盘文件，
 * 避免频繁重取造成抖动，同时保证切回页面时数据仍是新鲜的。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false
    }
  }
});
