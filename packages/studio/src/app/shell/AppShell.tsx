import { NavLink, Outlet, useLocation } from "react-router-dom";
import { navigationItems, shellCopy } from "@/config/navigation";
import { Badge } from "@/shared/components/ui/Badge";
import { useWorkspaceStore } from "@/shared/stores/workspaceStore";

export function AppShell() {
  const { sidebarCollapsed, toggleSidebar } = useWorkspaceStore();
  const location = useLocation();
  const isEditorRoute = location.pathname === "/editor";

  return (
    <div className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}${isEditorRoute ? " editor-shell" : ""}`}>
      {!isEditorRoute ? (
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark">IA</div>
            <div className="brand-copy">
              <p className="eyebrow">{shellCopy.brandEyebrow}</p>
              <h1>{shellCopy.brandName}</h1>
            </div>
            <button
              aria-label={sidebarCollapsed ? "展开左侧功能栏" : "收起左侧功能栏"}
              className="sidebar-toggle"
              type="button"
              onClick={toggleSidebar}
            >
              {sidebarCollapsed ? ">>" : "<<"}
            </button>
          </div>

          <nav className="nav-list" aria-label="主导航">
            {navigationItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
                >
                  <Icon size={18} />
                  <span className="nav-label">{item.label}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="sidebar-card">
            <Badge tone="amber">{shellCopy.sidebarBadge}</Badge>
            <strong>{shellCopy.sidebarTitle}</strong>
            <p>{shellCopy.sidebarDescription}</p>
          </div>
        </aside>
      ) : null}

      <main className="main-stage">
        {!isEditorRoute ? (
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
