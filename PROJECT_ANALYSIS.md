# Ink Agent Studio 项目分析报告

> 分析日期：2026-08-01（第三次分析，全量更新）
> 分析对象：`ink-agent-studio`（pnpm workspace monorepo，git 分支 main）
> 验证方式：本次分析实际运行了 `pnpm test`（43 个文件 / 98 个用例全部通过）与 `pnpm typecheck`（三个包均通过）

---

## 一、项目定位

Ink Agent Studio 是一个**本地优先（local-first）的 AI 长篇小说创作 Agent 系统**。它用 Agent 流水线自动完成长篇小说的作品初始化（世界观/角色/细纲/初始状态）、续写、审稿、去 AI 味润色、连续性检查，并把**写作风格约束**与**去 AI 味**作为核心差异化能力，配以**偏好记忆**（memory）与**小说技能**（skills）两个可控注入层。

核心设计理念：

- **本地优先**：作品以本地文件系统存储——JSON 为机器可读事实源、Markdown 为用户可读投影；API Key 用 AES-256-GCM 本地加密（`secretStore`）；无外部数据库、无云依赖，单机即可运行。
- **可重放的运行时**：Run / 事件 / 检查点 / 模型尝试全部持久化到 SQLite（8 个迁移版本），支持中断恢复、重启自动恢复作品初始化任务。
- **极广的模型接入面**：OpenAI-compatible / Ollama / DeepSeek 三个 adapter 已实现，规划支持 20+ provider 与本地模型、三方中转站。
- **受控的长期记忆与技能**：用户写作偏好（10 类）与小说技能按 Token 预算注入 Prompt，均带严格生命周期与安全边界（写入需人工批准、已批准内容不可变、偏好不得覆盖作品事实）。

---

## 二、整体架构

pnpm workspace monorepo，`pnpm-workspace.yaml` 声明 `backend` 与 `packages/*`。根 `package.json` 仅做脚本编排，构建顺序 **contracts → backend → studio**。

| 模块 | 包名 | 职责 |
|------|------|------|
| `backend/` | `@ink-agent/backend` | Hono HTTP/SSE 后端，承载全部业务逻辑（约 68% 代码量） |
| `packages/studio/` | `@ink-agent/studio` | React 19 前端，10 个功能页（约 31% 代码量） |
| `packages/contracts/` | `@ink-agent/contracts` | 共享 Zod schema + 类型契约 |

依赖关系：backend 与 studio 均通过 `workspace:*` 依赖 contracts；studio 经 Vite `/api` 代理调用后端 `/api/v1`（127.0.0.1:8787）。

**仍为空壳的占位目录**：`frontend/`、`packages/cli/`、`packages/core/`、`docs/`、`ops/`、`scripts/`，以及 studio 的 `src/api`、`src/components`、`src/data`、`src/pages`、`src/stores`、`src/styles`、`src/types` 与 `features/{agent,book,chapter,model,showcase,state}`。其中 AgentPage、StatePage 已被删除，页面集中在 `features/<feature>/pages`。

---

## 三、技术栈

| 层面 | 选型 |
|------|------|
| 语言/运行时 | TypeScript 5.7，ESM，Node ≥ 22.16（依赖 `node:sqlite`） |
| 前端 | React 19 + Vite 6 + React Router 7 + Zustand 5 + TanStack Query 5 + lucide-react；无 UI 框架，手写 CSS |
| 后端 | Hono 4 + `@hono/node-server` + Zod 3 + dotenv；`tsx watch` 开发、`tsc` 生产构建 |
| 数据层 | Node 原生 `node:sqlite`（DatabaseSync，STRICT 表 + 触发器）+ 本地 JSON/Markdown 文件 |
| 搜索 | SQLite FTS5（trigram tokenizer）全文检索会话消息 |
| 测试 | Vitest（本次实测 43 文件 / 98 用例全绿） |

---

## 四、后端（项目主体）

**规模**：约 **15,700 行、166 个 ts 文件、43 个测试文件**（本次实测全绿），占全项目约 68%。

**启动流程（`src/index.ts`）**：`createApplicationServices` 组装全部服务 → `ensureWorkspace` 初始化工作区 → `workspaceLease.acquire()` 获取租约锁 → `configService.initialize()` → SQLite 迁移（迁移前自动备份）→ legacy run 导入 → 恢复未完成 patch → `runCoordinator.recoverAndResumeRequiredWorkflows()` 自动重入队未完成的作品初始化 → 启动服务 → 注册优雅关闭。工程化程度高。

**分层与运行时**：

- `src/runtime/`（本轮新增的工程化层）：`applicationServices.ts`（服务组装根）、`workspaceLease.ts`（单实例租约锁）、`gracefulShutdown.ts`、`database/runtimeDatabase.ts` + `runtimeMigrations.ts`（8 个迁移版本）。
- `src/config/`：`configService` 读取/校验/重载 `app-config.json`（带 revision + configHash，Run 快照关联配置版本），支持 12 组配置段（runtime 并发、events 流控、models 重试、context Token 预算、memory/skills 注入预算等），feature 开关集中在 `features.asyncRuns/agentLoop/patchApply/skills/plugins/mcp/cron`（当前多为 false，仅系统必需工作流可用 Run 队列）。

**核心业务模块（按代码量）**：

| 模块 | 行数 | 职责要点 |
|------|------|----------|
| `agents/` | 3,055 | **运行编排核心**：RunCoordinator（有界队列 + 全局/单书并发 + AbortController + 重启恢复）、runEventStore（682 行，事件/检查点/工件/模型尝试持久化）、bookInitializationService（749 行，作品初始化流水线）、runCommandHandlers（continue/review/polish/consistency 四个命令）、legacyRunImporter、runSse、degradationPolicy |
| `styles/` | 1,977 | 写作风格域：样本选择/质量、特征提取、约束编译 V1/V2、合规检查、版本管理、风格锁、场景化调整、运行时上下文 |
| `ai/` | 1,255 | 模型网关 `modelGateway`：Adapter 模式（openai-compatible 170 行、ollama、deepseek）、路由/fallback/重试/超时/Token 统计/统一错误/abort 信号、modelAnalysisService |
| `books/` | 1,243 | 作品/章节/实体（角色·势力·地点·物品）/模板；chapterService 533 行 |
| `review/` | 1,179 | 去 AI 味引擎（规则注册表、约束编译器、本地评审器）+ 语义风格评审 + 聚合 |
| `memory/` | 458 | 用户偏好长期记忆：10 类偏好、proposed→active→rejected/archived 生命周期、Prompt 注入（Token 预算 1200） |
| `skills/` | 435 | 技能元数据 + 启停 + 渐进加载（内置 6 个技能：章节规划/续写/审稿/连续性/伏笔/风格复刻/去AI润色） |
| `patches/` | 384 | 状态补丁审批日志（proposed→applied/rejected，带 base/proposed hash 与备份） |
| `sessions/` | 358 | 会话 + 消息 + FTS5 搜索 + session-runs 关联 |
| 其余 | ~700 | constraints（约束解析）、tools（工具注册表）、prompts、scenes、files、models、workspace |

**作品初始化流水线**（bookInitializationService，本轮已核实的最复杂业务）：
`foundation → world → story_graph → outline（outline_plan + entity_requirements）→ supporting_entities → items → initial_state → consistency_review → apply_bundle`。
特点：每个 stage 有独立 Zod schema（带 `schemaVersion` 字面量）、`runStage` 通用执行器支持**检查点恢复**（从已存 artifact 恢复）、结构化输出校验失败自动**带错误回修一次**、跨 stage 引用完整性校验（实体 ID 悬空检测）、一致性审查不过即中止、apply_bundle 为不可逆提交（`markCommitted` 防止取消误报）、单 stage 超时 300s、规划/审稿双模型路由（无审稿模型时降级用规划模型）。

**RunCoordinator 并发模型**：全局并发（默认 2）+ 单作品写并发（默认 1，防止同书并发写冲突）+ 队列上限（50）；重启后内存队列不伪装运行，遗留任务先标 `interrupted`，仅 `initialize_book` 可自动恢复（`resumeSystem` 也允许恢复 failed/cancelled 系统运行）；取消走 AbortController + `cancelling` 状态。

**数据层设计原则**：作品正文与权威 BookState 只存本地文件，**不进 SQLite**；SQLite 只存可重放的运行数据（runs/run_events/run_artifacts/run_checkpoints/model_attempts/state_patches/sessions/session_messages/user_preferences/legacy_import_entries）。密钥单独存 `secretStore`（AES-256-GCM，密钥派生自 `INK_AGENT_SECRET_KEY` 或工作区路径）。

**SQLite 迁移（v1→v8）**：v1 运行事件核心表（全部 STRICT + CHECK 约束 + 索引）；v2 状态补丁日志；v3 会话 + FTS5 trigram 全文搜索 + 关联触发器和 runs 加会话列；v4 模型尝试加币种；v5 用户偏好表（active key 唯一索引）；v6 拒绝原因列；v7 偏好生命周期触发器（来源归属校验、状态机约束、生命周期元数据一致性）；v8 已批准偏好内容不可变触发器。

---

## 五、前端 Studio

**规模**：约 **12,700 行、44 个文件**（上轮 6,433 行/35 文件，**接近翻倍**），feature-based 结构。

**页面（10 个，全部已联调后端）**：

| 路径 | 页面 | 行数 | 能力 |
| --- | --- | --- | --- |
| `/` | 总览 | 33 | 功能入口汇总（本轮全面改版，独立 CSS 445 行） |
| `/workspace` | 作品库 | 776 | 作品列表/创建/删除/详情、角色与 Markdown 查看、风格绑定 |
| `/editor` | 章节编辑器 | 573 | 沉浸式三栏布局（信息/正文/助手），已拆出 EditorMainPanel、AssistantPanels |
| `/styles` | 写作风格 | 520 | 样本分析、版本重建/激活，已拆出 StyleDetailView、AnalysisResultPanel |
| `/anti-ai` | 去 AI 味 | 161 | 全局约束 + 风格协同规则查看 |
| `/skills` | 小说技能 | 43 | 技能启停 |
| `/memory` | 偏好记忆 | 238 | 偏好提议/批准/拒绝/归档 + Prompt 注入预览（上轮为占位，本轮已落地） |
| `/models` | 模型配置 | 634 | 模型 CRUD、连接测试、用途路由、体系诊断（拆出 ModelAnalysisPanel） |
| `/runs` | 运行记录 | 248 | Run 列表/详情、SSE 事件、模型尝试、取消/恢复、补丁审批 |
| `/settings` | 设置 | 275 | 本地运行配置读取/更新/重载 |

**UI 壳（本轮核心变化）**：`AppShell.tsx` + `AppShell.css`（1,346 行）全面改版——侧边栏按「创作 / 智能协作 / 系统」三段分组（`navigation.ts` 集中维护元数据：图标、eyebrow、描述），浅色控制台设计语言；`global.css` 已膨胀至 **5,657 行**。

**状态与服务端数据**：Zustand 两个 store（workspace UI、modelConfig）；TanStack Query 用于运行记录等服务端状态；页面不直接 `fetch`，统一走 `shared/api/http.ts` 与 feature 级 API 层（workspaceApi 328 行、writingStylesApi 264 行、modelConfigApi 103 行）。

**已知边界（README 声明）**：编辑器正文保存、实体新增、右侧 AI 对话仍待接入；无独立前端测试套件（类型检查 + 构建为回归门槛）；不做假数据掩盖接口失败。

---

## 六、共享契约层 contracts

约 **583 行、12 个文件**。导出 common / patches / runEvents / runs / sessions / modelAttempts / skills / memory / settings。特点：schema 带 `schemaVersion` 字面量并用 `.strict()` 严格校验；`runs.ts` 用 discriminatedUnion 定义运行命令（含 continue_chapter / review_chapter / polish_chapter / consistency_check / initialize_book）；后端 `RunCoordinator` 直接 import contracts 的 `runCommandSchema` 解析命令。作品·模型·风格 schema 仍留在 `backend/src/schemas/`，尚未全部上提。

---

## 七、代码规模总览

| 模块 | 代码行 | 文件数 | 占比 |
|------|--------|--------|------|
| backend/src | 15,681 | 166 | ~54% |
| packages/studio/src | 12,714 | 44 | ~44% |
| packages/contracts/src | 583 | 12 | ~2% |
| **合计** | **~28,978** | **222** | 100% |

（上轮 22,074 行 / 208 文件，**新增约 6,900 行**；前端测试文件 45 个、3,654 行另计）

最大单文件：`global.css`(5,657)、`AppShell.css`(1,346)、`WorkspacePage.tsx`(776)、`ModelsPage.tsx`(634)、`EditorPage.tsx`(573)、`WritingStylesPage.tsx`(520)、`bookInitializationService.ts`(749)、`runEventStore.ts`(682)、`runCoordinator.ts`(370)、`chapterService.ts`(533)、`workspaceApi.ts`(328)。

**数据目录现状**：`data/workspaces/default/` 下有真实作品（`4f9711cb-...`，含 book.json、brief.md、outline.md、world.md、state/current.md、state/foreshadowing.md、entities.json、chapters.json、files.json），但 `chapters/`、`entities/characters`、`imports/`、`runs/` 目录为空——章节正文尚未生成，符合编辑器正文待接入的状态；styles 下有已建风格的版本样本；skills 下 6 个内置技能 SKILL.md 齐备。

---

## 八、开发状态与活跃度

- git 历史 3 次提交：`Initial ink agent studio frontend` → `feat: add backend integration and model config fixes` → `feat(studio): refresh writing workbench UI`（2026-07-24，重写总览页与 AppShell）。
- **当前工作区有约 60 个 modified + 100+ 个 untracked 文件未提交**（backend 全线、studio 全线、根 package.json），本地领先 origin/main 1 个提交——自 7-24 起约一周的进行中工作未落盘。
- 测试与类型检查现状（本次实测）：`pnpm test` 43 文件 / 98 用例全绿；`pnpm typecheck` 三包全过。
- 计划按 P0–P15 阶段推进；作品初始化流水线已具备端到端能力（路由 `POST /api/v1/books/init`），下一步自然是章节续写/审稿链路（runCommandHandlers 已注册）与编辑器 AI 对话接入。

结论：**早期高速迭代、工程化扎实但版本管理粒度粗**；本轮主要是 UI 大改版（studio 增长近一倍）与运行系统的完整落地。

---

## 九、优势与改进建议

**优势**

- 后端工程化完整：8 个迁移版本（含触发器级数据约束）、迁移前备份、租约锁、优雅关闭、中断恢复、自动恢复、SSE、版本化配置。
- 初始化流水线的可恢复性设计到位：阶段检查点 + 工件缓存 + 结构校验自动回修 + 跨阶段引用校验 + 不可逆提交标记，质量门槛高。
- 并发控制谨慎：全局并发 2 / 单作品写并发 1 / 队列上限，避免本地小说创作场景的同书写冲突。
- 数据分层清晰：文件（事实源）与 SQLite（可重放运行数据）职责分明，密钥独立加密存储。
- memory 与 skills 的受控注入：生命周期触发器（v7/v8 迁移）+ 人工批准 + Token 预算，安全性设计是亮点。
- 前端 UI 改版完成度高：导航元数据集中化、页面组件化拆分（editor/styles/models 均已拆 components）、README 同步维护。

**改进建议**

- **版本管理粒度**：60+ 修改、100+ 未跟踪文件悬置一周，强烈建议拆成小步提交（先提交后端运行系统、再提交 UI 改版），降低回溯风险。
- **global.css 膨胀**：5,657 行单文件已超合理阈值，建议按页面/组件拆分或引入 CSS Modules。
- **契约收敛**：作品/模型/风格 schema 仍留在 `backend/src/schemas/`，建议参照 memory.ts 上提到 contracts，统一前后端类型来源。
- **前端测试缺失**：studio 无测试套件，建议对 workspaceApi 等 API 适配层补充关键路径测试。
- **编辑器联调**：`/editor` 正文保存、实体新增、AI 对话是当前最大功能缺口，runCommandHandlers 已备好但前端未接。
- **占位目录清理**：`frontend/`、`packages/cli`、`packages/core`、`ops/`、`scripts/`、`docs/` 及 studio 十余个空目录长期空置，建议在 README 标注规划占位或直接删除。
- **数据目录**：示例作品已生成但章节实体目录为空，可考虑用已完成的初始化流水线生成一份真实章节样例，同时验证续写链路。
