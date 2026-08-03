# Ink Agent Studio 前端

Ink Agent Studio 是本地优先小说创作系统的 React 前端，位于 pnpm workspace 的 `packages/studio`。当前版本已经通过 `/api/v1` 与 `backend` 中的 Hono 服务联调，不再使用 `localStorage` 模拟模型配置或作品数据。

## 技术栈

- React 19、TypeScript、Vite
- React Router：页面路由与沉浸式编辑器入口
- TanStack Query：运行记录等服务端状态
- Zustand：工作区 UI 状态和模型配置状态
- lucide-react：页面与导航图标
- `@ink-agent/contracts`：前后端共享的运行、记忆、技能和设置类型

## 启动方式

在仓库根目录安装依赖：

```powershell
pnpm install
```

Windows 下推荐直接运行：

```powershell
.\start-studio.cmd
```

脚本会检查依赖，在后台启动后端，再以前台方式启动 Studio。默认地址：

- Studio：`http://127.0.0.1:5173`
- Backend：`http://127.0.0.1:8787`
- 健康检查：`http://127.0.0.1:8787/api/v1/health`

也可以分别启动：

```powershell
pnpm dev:backend
pnpm dev:studio
```

Studio 默认使用 `VITE_API_BASE_URL=/api/v1`，开发环境由 Vite 将 `/api` 代理到 `http://127.0.0.1:8787`。需要覆盖时参考 `packages/studio/.env.example` 和 `backend/.env.example`。

## 页面与功能

| 路径 | 页面 | 当前能力 |
| --- | --- | --- |
| `/` | 总览 | 汇总已实现的正式功能入口 |
| `/workspace` | 作品库 | 作品列表、创建、删除、详情、角色与 Markdown 文件查看、写作风格绑定；AI 初始化/重试时实时显示阶段执行详情与模型流式输出，支持暂停执行与从检查点继续 |
| `/editor` | 章节编辑器 | 从作品详情进入，读取作品基础数据并提供沉浸式三栏编辑布局 |
| `/styles` | 写作风格 | 风格列表、文本样本分析、样本管理、版本重建与激活 |
| `/anti-ai` | 去 AI 味 | 查看生成、审稿和修订共用的全局约束及风格协同规则 |
| `/skills` | 小说技能 | 查看技能元数据并启用或停用规划、写作、审稿技能 |
| `/memory` | 偏好记忆 | 提议、批准、拒绝、归档长期偏好，并预览实际 Prompt 注入 |
| `/models` | 模型配置 | 模型增删改、连接测试、默认模型、用途路由和模型体系诊断 |
| `/runs` | 运行记录 | Run 列表与详情、SSE 事件、模型尝试、取消/恢复和状态补丁审批 |
| `/settings` | 设置 | 读取、更新和重新加载本地运行配置 |

`/editor` 不在侧边栏直接展示，因为它需要作品上下文；应从 `/workspace` 的作品详情进入。

## 当前边界

- 章节编辑器已经读取真实作品详情，但章节正文保存、实体新增和右侧 AI 对话仍是待接入区域。
- 写作风格只接受 TXT、Markdown 文本样本；接口失败时直接显示错误，不再生成前端模拟分析结果。
- 前端没有为后端不可用场景注入示例作品、示例模型或示例运行记录，避免假数据掩盖真实状态。
- Studio 当前没有独立前端测试套件；类型检查和生产构建是前端的基础回归门槛，业务接口由 contracts/backend 测试覆盖。

## 主要接口

| 功能域 | 接口前缀或代表接口 |
| --- | --- |
| 作品与文件 | `/api/v1/books`、`/api/v1/books/:bookId/files/:fileId` |
| 写作风格 | `/api/v1/writing-styles`、`/samples`、`/versions`、`/constraint-preview` |
| 模型配置 | `/api/v1/model-configs`、`/api/v1/model-routes`、`/api/v1/model-analysis` |
| 运行与补丁 | `/api/v1/runs`、`/api/v1/runs/:runId/events`、`/api/v1/patches` |
| 小说技能 | `/api/v1/skills` |
| 偏好记忆 | `/api/v1/memory/preferences`、`/api/v1/memory/prompt-preview` |
| 去 AI 味 | `/api/v1/anti-ai-constraints` |
| 设置 | `/api/v1/settings` |

统一 HTTP 封装位于 `src/shared/api/http.ts`。功能专属接口优先放在对应 feature 的 `api/`，跨页面接口放在 `src/shared/api/`；页面组件不要直接调用 `fetch`。

## 目录结构

```text
packages/studio/
  src/
    app/
      App.tsx                 路由注册
      queryClient.ts          TanStack Query 客户端
      shell/                  全局侧边栏、顶部栏和正式页面视觉层
    config/
      navigation.ts           页面元数据和侧边栏导航
      modelOptions.ts         模型服务商及用途选项
    features/
      dashboard/              功能总览
      workspace/              作品库、类型和 Markdown 弹窗组件
      editor/                 编辑器页面与右侧助手子组件
      writing-styles/         风格 API、类型、页面和分析结果组件
      anti-ai/                去 AI 味约束
      skills/                 小说技能
      memory/                 偏好记忆
      models/                 模型配置页面和体系分析组件
      runs/                   运行监控与补丁审批
      settings/               本地设置
    shared/
      api/                    跨功能 API 适配层
      components/ui/          通用 UI 组件
      stores/                 Zustand store
      styles/global.css       基础样式和各功能页面样式
      types/domain.ts         前端共享领域类型
```

大型页面按职责拆分：页面文件负责状态编排和视图切换，`components/` 负责独立展示区域，feature 私有类型放在自身目录，避免继续扩大单文件。

## 样式约定

- `/` 的浅色工作台是正式页面视觉基准：白、灰、浅蓝背景，细边框、低阴影、克制动效。
- 普通功能页共享 `AppShell` 和 `PageHeader`；编辑器保留沉浸式布局，但使用相同颜色和材质。
- 全局壳样式位于 `src/app/shell/AppShell.css`，基础组件和功能样式位于 `src/shared/styles/global.css`。
- 新页面必须验证窄屏、长文本和浏览器缩放，不得产生页面级横向溢出。
- 页面标题由 `src/config/navigation.ts` 的路由元数据驱动，不要在全局顶部栏重复硬编码。

## 开发约定

- 新增或删除正式页面时，同时更新 `src/app/App.tsx`、`src/config/navigation.ts` 和本文档。
- 业务页面放入 `src/features/<feature>/pages`；可复用展示区域放入同 feature 的 `components/`。
- 前后端共同使用的结构优先加入 `@ink-agent/contracts`，前端私有类型留在对应 feature 或 `src/shared/types`。
- 不使用前端模拟成功结果掩盖接口失败；错误、空状态和加载状态必须反映真实后端状态。
- API Key 的保存、加密和模型调用由后端负责，前端只提交配置并显示脱敏结果。

## 校验命令

在仓库根目录执行：

```powershell
pnpm typecheck
pnpm test
pnpm build
```

README 是 Studio 当前实现的维护入口。页面、目录、接口或开发边界变化后应同步更新本文件。
