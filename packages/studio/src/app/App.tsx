/**
 * 应用根组件：集中声明全部路由表。
 * 所有功能页均挂在 AppShell 布局下，未知路径统一重定向到首页，保持单层路由结构。
 */
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/app/shell/AppShell";

const DashboardPage = lazy(() => import("@/features/dashboard/pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const EditorPage = lazy(() => import("@/features/editor/pages/EditorPage").then((module) => ({ default: module.EditorPage })));
const ModelsPage = lazy(() => import("@/features/models/pages/ModelsPage").then((module) => ({ default: module.ModelsPage })));
const RunsPage = lazy(() => import("@/features/runs/pages/RunsPage").then((module) => ({ default: module.RunsPage })));
const SettingsPage = lazy(() => import("@/features/settings/pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const WorkspacePage = lazy(() => import("@/features/workspace/pages/WorkspacePage").then((module) => ({ default: module.WorkspacePage })));
const WritingStylesPage = lazy(() => import("@/features/writing-styles/pages/WritingStylesPage").then((module) => ({ default: module.WritingStylesPage })));
const AntiAiConstraintsPage = lazy(() => import("@/features/anti-ai/pages/AntiAiConstraintsPage").then((module) => ({ default: module.AntiAiConstraintsPage })));
const SkillsPage = lazy(() => import("@/features/skills/pages/SkillsPage").then((module) => ({ default: module.SkillsPage })));
const MemoryPage = lazy(() => import("@/features/memory/pages/MemoryPage").then((module) => ({ default: module.MemoryPage })));
const StoryKnowledgePage = lazy(() => import("@/features/knowledge/pages/StoryKnowledgePage").then((module) => ({ default: module.StoryKnowledgePage })));

/** 应用入口组件：负责路由渲染，不承载业务逻辑，新增功能页时在此注册路由。 */
export function App() {
  return (
    <Suspense fallback={<div className="page-route-loading">正在载入功能页…</div>}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="workspace" element={<WorkspacePage />} />
          <Route path="editor" element={<EditorPage />} />
          <Route path="styles" element={<WritingStylesPage />} />
          <Route path="anti-ai" element={<AntiAiConstraintsPage />} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="memory" element={<MemoryPage />} />
          <Route path="knowledge" element={<StoryKnowledgePage />} />
          <Route path="models" element={<ModelsPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
