import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/app/shell/AppShell";
import { AgentPage } from "@/features/agent/pages/AgentPage";
import { DashboardPage } from "@/features/dashboard/pages/DashboardPage";
import { EditorPage } from "@/features/editor/pages/EditorPage";
import { ModelsPage } from "@/features/models/pages/ModelsPage";
import { RunsPage } from "@/features/runs/pages/RunsPage";
import { SettingsPage } from "@/features/settings/pages/SettingsPage";
import { StatePage } from "@/features/state/pages/StatePage";
import { WorkspacePage } from "@/features/workspace/pages/WorkspacePage";
import { WritingStylesPage } from "@/features/writing-styles/pages/WritingStylesPage";

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="workspace" element={<WorkspacePage />} />
        <Route path="editor" element={<EditorPage />} />
        <Route path="styles" element={<WritingStylesPage />} />
        <Route path="agent" element={<AgentPage />} />
        <Route path="state" element={<StatePage />} />
        <Route path="models" element={<ModelsPage />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
