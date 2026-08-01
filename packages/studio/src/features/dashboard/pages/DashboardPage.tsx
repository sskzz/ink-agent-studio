import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { navigationItems } from "@/config/navigation";
import { Badge } from "@/shared/components/ui/Badge";

const featurePages = navigationItems.filter((item) => item.to !== "/");

export function DashboardPage() {
  return (
    <div className="page">
      <section className="hero-panel">
        <Badge tone="sage">功能总览</Badge>
        <h2>一套本地工作台，覆盖作品管理、写作质量与运行审计。</h2>
        <p>
          这里仅展示已经具备页面和数据逻辑的正式能力。章节编辑器从作品库进入，所有生成过程由模型配置、
          小说技能、偏好记忆与去 AI 味规则共同约束，并在运行记录中保留可审计信息。
        </p>
      </section>

      <section className="metric-grid dashboard-feature-grid" aria-label="已实现功能页面">
        {featurePages.map((item) => {
          const Icon = item.icon;
          return (
            <Link className="metric-card dashboard-feature-card" key={item.to} to={item.to}>
              <span className="dashboard-feature-icon"><Icon size={18} aria-hidden="true" /></span>
              <span className="dashboard-feature-copy">
                <small>{item.section}</small>
                <strong>{item.label}</strong>
                <p>{item.description}</p>
              </span>
              <ArrowUpRight className="dashboard-feature-arrow" size={16} aria-hidden="true" />
            </Link>
          );
        })}
      </section>
    </div>
  );
}
