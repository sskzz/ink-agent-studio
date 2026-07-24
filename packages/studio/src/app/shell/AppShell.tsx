import { CheckCircle2, HardDrive, PanelLeftClose, PanelLeftOpen, SquarePen } from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { navigationItems, shellCopy } from "@/config/navigation";
import { useWorkspaceStore } from "@/shared/stores/workspaceStore";
import "./AppShell.css";

const navigationSections = ["创作", "智能协作", "系统"] as const;

function getSceneName(pathname: string) {
  const routeName = pathname.split("/")[1];
  return routeName || "dashboard";
}

export function AppShell() {
  const { sidebarCollapsed, toggleSidebar } = useWorkspaceStore();
  const location = useLocation();
  const isDashboardRoute = location.pathname === "/";
  const isEditorRoute = location.pathname === "/editor";
  const isAntiAiRoute = location.pathname === "/anti-ai";
  const sceneName = getSceneName(location.pathname);

  return (
    <div
      className={`app-shell ink-shell scene-${sceneName}${sidebarCollapsed ? " sidebar-collapsed" : ""}${isDashboardRoute ? " dashboard-shell" : ""}${isEditorRoute ? " editor-shell" : ""}${isAntiAiRoute ? " anti-ai-shell" : ""}`}
      data-scene={sceneName}
    >
      {!isEditorRoute ? (
        <div className={`writing-ambient ambient-${sceneName}`} aria-hidden="true">
          {Array.from({ length: 10 }, (_, index) => <span key={index} />)}
        </div>
      ) : null}

      {!isEditorRoute ? (
        <aside className="sidebar" aria-label="左侧功能栏">
          <div className="sidebar-topline">
            <div className="brand">
              <div className="brand-mark">IA</div>
              <div className="brand-copy">
                <p className="eyebrow">{shellCopy.brandEyebrow}</p>
                <h1>{shellCopy.brandName}</h1>
              </div>
            </div>
            <button
              aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? "展开左侧功能栏" : "收起左侧功能栏"}
              className="sidebar-toggle"
              type="button"
              onClick={toggleSidebar}
              title={sidebarCollapsed ? "展开功能栏" : "收起功能栏"}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
          </div>

          <div className="sidebar-expandable">
            <Link className="sidebar-create-button" to="/workspace">
              <SquarePen size={17} />
              <span>新建作品</span>
              <kbd>Ctrl K</kbd>
            </Link>

            <div className="sidebar-nav-scroll">
              <nav className="nav-list" aria-label="主导航">
                {navigationSections.map((section) => (
                  <div className="nav-section" key={section}>
                    <p className="nav-section-title">{section}</p>
                    {navigationItems.filter((item) => item.section === section).map((item) => {
                      const Icon = item.icon;
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.to === "/"}
                          className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
                          title={item.label}
                        >
                          <Icon size={17} />
                          <span className="nav-label">{item.label}</span>
                          <span className="nav-item-indicator" />
                        </NavLink>
                      );
                    })}
                  </div>
                ))}
              </nav>
            </div>

            <div className="sidebar-card">
              <span><HardDrive size={15} /> Local workspace</span>
              <strong><CheckCircle2 size={15} /> 已安全同步</strong>
            </div>
          </div>
        </aside>
      ) : null}

      <main className="main-stage">
        {!isEditorRoute && !isDashboardRoute ? (
          <header className="topbar">
            <div>
              <p className="eyebrow">{shellCopy.topbarEyebrow}</p>
              <h2>{shellCopy.topbarTitle}</h2>
            </div>
            <div className="topbar-actions" aria-label="工作台状态">
              <span className="status-pill">{shellCopy.statusPills[0]}</span>
              <span className="command-pill">{shellCopy.statusPills[1]}</span>
            </div>
          </header>
        ) : null}

        {/* 主内容始终占满可用空间。 */}
        <section className="content-grid rail-hidden">
          <div className="page-surface">
            {/* key 跟随路由变化，让不同功能页切换时重新触发进入动画。 */}
            <div className="route-transition" key={location.pathname}>
              <Outlet />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
