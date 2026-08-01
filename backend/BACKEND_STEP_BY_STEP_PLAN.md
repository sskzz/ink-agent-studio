# InkOS 技术栈后端逐步开发计划

本文档用于指导 Ink Agent Studio 后端从 0 到可用的分阶段开发。技术路线采用 InkOS 同款轻量本地优先栈：Node.js 22、pnpm workspace、TypeScript、Hono、`@hono/node-server`、Vercel AI SDK、本地 JSON/Markdown 文件系统。

## 总体原则

- 第一版以本地自用为目标，不先引入复杂数据库、账号权限、容器编排。
- JSON 是机器可读事实源，Markdown 是用户可读和可编辑内容。
- 所有 AI 生成内容先进入草稿、预览或 diff，不直接覆盖用户正文。
- 前端页面和 store 尽量不大改，后端通过 `/api/v1` 接口替换当前 mock API。
- 每个阶段都必须能启动、能测试、能回滚，不做一次性大爆改。

## 当前执行进度

- 2026-07-08：已完成 P0 后端工程骨架。当前包含 `backend/package.json`、`tsconfig.json`、Hono app、`@hono/node-server` 启动入口、健康检查接口、统一响应和统一异常处理。
- 2026-07-08：已完成 P1 本地工作区与文件系统基础。当前包含工作区路径生成、本地目录初始化、安全路径校验、原子文本写入、JSON 读写、hash 工具和工作区摘要接口。
- 2026-07-08：已完成 P2 基础领域类型与 Zod Schema。当前包含作品、文件、模型、运行记录的 TypeScript 类型和 schema。
- 2026-07-08：已补充基础测试，覆盖安全路径和工作区初始化；`pnpm --dir backend typecheck`、`pnpm --dir backend test`、`pnpm --dir backend build` 均已通过。
- 2026-07-08：已完成 P7 模型配置与密钥管理。当前包含模型配置 CRUD、默认模型设置、模型路由读写、API Key 加密保存、普通接口不回传密钥。
- 2026-07-08：已完成 P8 模型网关与连接测试第一版。当前包含统一模型网关、OpenAI Compatible/Ollama/DeepSeek 连接测试 adapter，以及未实现 provider 的标准提示返回。
- 2026-07-08：已验证模型配置 API smoke test，`POST /api/v1/model-configs`、`GET /api/v1/model-configs`、`POST /api/v1/model-configs/test` 可正常返回。
- 2026-07-09：已补充 P8+ 模型体系本地分析能力。当前包含 `GET /api/v1/model-analysis`，可返回模型配置健康分、写作/审稿/规划路由状态、参数风险、adapter 覆盖和优化建议；该接口不读取 API Key，也不真实调用模型。
- 2026-07-08：已完成 P3 作品库列表与作品详情。当前包含 `GET /api/v1/books`、`GET /api/v1/books/:bookId`、作品详情 DTO、核心文件和世界观索引；空 workspace 必须返回空数组，不再自动创建演示作品。
- 2026-07-08：已完成 P4 新建作品与作品目录生成。当前包含 `POST /api/v1/books`、`PATCH /api/v1/books/:bookId`、`DELETE /api/v1/books/:bookId`，新建作品会生成 `book.json`、核心 Markdown、files/entities/chapters 索引和标准目录。
- 2026-07-08：已验证作品 API smoke test，空 workspace 下 `GET /api/v1/books` 返回空数组，`POST /api/v1/books` 可创建作品，创建后文件、实体、章节和 AI 占位接口可正常返回。
- 2026-07-08：已完成 P5 Markdown 文件读取、保存与解析。当前包含文件列表、文件详情、文件保存、Markdown 上传和轻量解析。
- 2026-07-08：已完成 P6 角色、势力、地点、物品实体管理。当前包含实体列表、创建、详情、更新、删除，并生成对应 Markdown 文件。
- 2026-07-08：已完成 P9 Agent Run 与基础 SSE。当前包含 run 快照、runs.jsonl 追加日志、run 查询和基础 SSE done 事件。
- 2026-07-08：已完成 P10-P12 第一版确定性实现。当前包含作品初始化、章节创建/保存/续写、审稿、去 AI 味、连续性检查接口；AI 内容先返回草稿或报告，不直接覆盖用户正文。
- 2026-07-08：已完成 P13 写作风格接口。当前包含写作风格列表、创建和模板作品模拟分析。
- 2026-07-08：已补充综合后端 smoke test，覆盖文件、实体、章节、AI 占位任务和写作风格接口。
- 2026-07-08：已完成 P14 基础前端 API 替换与联调。当前模型配置、作品库列表/详情/新建作品、写作风格列表/创建/分析已优先调用后端 `/api/v1`；后端不可用、接口返回空数组或详情读取失败时显示空状态/错误提示，不再展示本地假数据兜底。
- 2026-07-09：已修复开发期 CORS 端口漂移问题。前端默认走 Vite `/api` 代理访问后端；后端 CORS 允许 `127.0.0.1` / `localhost` 的本地开发来源，并支持通过 `INK_AGENT_ALLOWED_ORIGINS` 补充额外来源。
- 2026-07-09：已根据 Open Design 审查修复 P14 流程一致性问题。新建作品会把上传的世界观 md 正文写入 `world.md`；写作风格分析只返回预览结果，不再绕过“保存风格”直接落库；继续写作页顶部作品状态和基础设置会读取来源作品详情。
- 2026-07-13：已完成写作风格约束第三阶段核心实现。新增多样本独立存储、样本质量权重、MAD 异常识别、聚合稳定度、不可变风格版本、旧 v3/v1 懒迁移、作品版本固定、场景识别与动态调节、固定优先级冲突解析、编译器 v2、结构化语义审稿、本地/语义双重评分、单次定向修订、Run 风格追踪与 token usage、完整降级信息，以及前端样本和版本管理入口。
- 2026-07-15：完成第三阶段代码审查修复。生成、审稿、润色统一使用运行时风格版本；Run 在模型调用前持久化并记录阶段耗时与失败 token；迁移移出读取链路；语义分析排除无效样本；比例指标增加合法域；事实约束追踪改为哈希和来源引用；增加进程内写锁、降级 Prompt 清理、前端状态刷新，以及完整 v2 端到端、并发、只读无写入和故障 Run 测试。
- 2026-07-22：完成 Hermes 风格长期用户偏好记忆。新增严格白名单合同、SQLite 迁移与生命周期触发器、提议/批准/拒绝/归档 API、来源 Session/Message 校验、作品事实拦截、同键原子替换、已批准内容不可变、Prompt Token/条目预算和选择 Trace；续写、自动修订、审稿、润色统一采用 `stable → facts → memory → scene → skills → turn` 六层 Prompt。Studio 新增偏好记忆管理、实际注入预览及公共 Memory 配置。偏好只描述稳定写作与协作习惯，不替代 JSON/Markdown BookState。
- 2026-07-30：完善新建作品 AI 初始化可靠性。创建与初始化入队作为一个业务操作，入队失败会回滚作品目录；后端重启自动恢复未完成的初始化 Run；最终 Bundle 写入具备文件索引、实体索引和 Markdown 的补偿回滚；前端支持轻量状态轮询、失败重试和世界观文件读取防竞态。
- 下一步建议：进入 P15 本地启动脚本与开发体验细化，并继续把编辑器章节、实体管理、AI run/SSE 从静态页面接入后端。

## 开发硬性要求

- 代码必须按功能模块分类归档，禁止把所有逻辑堆在同一个路由文件或工具文件中。
- AI 模型 API 接入统一放入 `modules/ai/adapters`，例如 OpenAI Compatible、Ollama、DeepSeek、Gemini 等 provider adapter。
- 模型统一调用、流式输出、重试、fallback、Token 统计统一放入 `modules/ai/modelGateway.ts` 和 `modules/ai/stream.ts`，业务模块不得直接调用厂商 SDK。
- Agent 编排、任务运行、SSE、运行快照统一放入 `modules/agents`。
- 去 AI 味、审稿、连续性检查、质量评分统一放入 `modules/review`，不要散落在章节、作品或模型模块中。
- 作品库、章节、角色、势力、地点、物品统一放入 `modules/books`，Markdown 文件读写和解析统一放入 `modules/files`。
- 模型配置、密钥管理、模型路由统一放入 `modules/models`，密钥不得进入普通日志和普通 JSON 配置。
- 每个模块必须有清晰入口文件，例如 `bookService.ts`、`modelGateway.ts`、`reviewService.ts`，方便后续维护和查找。
- 代码需包含详细中文注释。模块入口、复杂业务函数、文件写入、模型调用、Prompt 拼装、去 AI 味规则、错误恢复逻辑必须写中文注释说明目的、输入、输出和注意事项。
- 注释要解释业务原因和风险，不写无意义注释。例如不要写“设置变量”，而要写“这里先写临时文件再 rename，避免进程退出导致 JSON 写坏”。

## P0：后端工程骨架

目标：创建一个能启动、能健康检查、能被前端代理调用的 Hono 后端。

建议新增文件：

```text
backend/
  package.json
  tsconfig.json
  src/
    index.ts
    app.ts
    routes/health.ts
    utils/http.ts
    utils/errors.ts
```

主要任务：

- 初始化 `backend/package.json`。
- 安装 `hono`、`@hono/node-server`、`tsx`、`typescript`、`zod`、`vitest`。
- 实现 `GET /api/v1/health`。
- 实现统一响应结构 `{ code, message, data }`。
- 实现统一异常处理。
- 配置 CORS，允许前端 `http://127.0.0.1:5173` 调用。
- 增加 `dev`、`build`、`typecheck`、`test` 脚本。

验收标准：

- `pnpm --dir backend dev` 能启动服务。
- `GET http://127.0.0.1:8787/api/v1/health` 返回正常。
- `pnpm --dir backend typecheck` 通过。

## P1：本地工作区与文件系统基础

目标：建立本地数据目录、路径安全校验、JSON 读写工具。

建议新增文件：

```text
backend/src/modules/workspace/
  workspacePaths.ts
  workspaceService.ts
backend/src/utils/
  fileStore.ts
  safePath.ts
  jsonStore.ts
  hash.ts
```

本地目录：

```text
data/workspaces/default/
  index/
    books.json
    model-configs.json
    model-routes.json
    runs.jsonl
  secrets/
  books/
```

主要任务：

- 支持通过环境变量配置数据目录，例如 `INK_AGENT_DATA_DIR`。
- 默认数据目录使用项目根目录下 `data/workspaces/default`。
- 实现安全路径拼接，禁止 `../` 路径穿越。
- 实现 JSON 文件读写，写入使用临时文件 + rename，降低写坏风险。
- 实现目录初始化，首次启动自动创建 index、secrets、books。
- 实现内容 hash，用于 Markdown 变更检测。

验收标准：

- 首次启动自动生成工作区目录。
- JSON 读写测试通过。
- 非法路径会被拒绝。

## P2：共享领域类型与 Zod Schema

目标：定义后端核心类型，保持与前端作品属性、模型配置一致。

建议新增文件：

```text
backend/src/schemas/
  bookSchemas.ts
  fileSchemas.ts
  modelSchemas.ts
  runSchemas.ts
backend/src/types/
  domain.ts
```

主要对象：

- `BookRecord`
- `BookDraftInput`
- `BookFileRecord`
- `BookEntityRecord`
- `ChapterRecord`
- `ModelConfigRecord`
- `ModelRouteRecord`
- `AgentRunRecord`

关键字段：

- 作品属性：作品名、题材、人称、频道、写作风格、主角性别、主角姓名、计划总字数、章节计划字数、世界观文件。
- 模型配置：provider、baseUrl、model、purpose、enabled、isDefault。
- 文件记录：fileType、title、path、summary、contentHash、parsedJson。

验收标准：

- 所有 API 入参先经过 Zod 校验。
- 前端已有字段都能在 schema 中找到对应字段。

## P3：作品库列表与作品详情

目标：用真实后端替代作品库 mock 数据的核心读取能力。

建议新增文件：

```text
backend/src/routes/books.ts
backend/src/modules/books/
  bookRepository.ts
  bookService.ts
  bookMappers.ts
```

接口：

- `GET /api/v1/books`
- `GET /api/v1/books/:bookId`

主要任务：

- 从 `index/books.json` 读取作品列表。
- 从 `books/{bookId}/book.json` 读取作品详情。
- 如果没有本地作品，`GET /api/v1/books` 返回空数组，由前端展示空状态，避免本地假数据掩盖真实接口状态。
- 返回作品属性、进度、角色列表、核心文件、世界观摘要。

验收标准：

- 前端作品库可从后端读取列表。
- 作品详情字段与当前前端展示一致。
- 作品库页面不硬编码本地演示作品数组。

## P4：新建作品与作品目录生成

目标：新建作品表单提交后，在本地创建真实作品目录和基础文件。

接口：

- `POST /api/v1/books`
- `PATCH /api/v1/books/:bookId`
- `DELETE /api/v1/books/:bookId`

创建目录：

```text
books/{bookId}/
  book.json
  brief.md
  outline.md
  world.md
  chapters/
  entities/
    characters/
    factions/
    locations/
    items/
  state/
    current.md
    foreshadowing.md
  runs/
  imports/
```

主要任务：

- 接收前端新建作品字段，全部允许为空。
- 空字段标记为 `needsAiFill`。
- 生成 `book.json`。
- 生成占位 `brief.md`、`outline.md`、`world.md`、`state/current.md`、`state/foreshadowing.md`。
- 更新 `index/books.json`。
- 删除作品时默认软删除，可配置是否删除本地文件。

验收标准：

- 前端新建作品后能在作品列表看到。
- 本地目录真实生成。
- 作品详情可打开新建作品。

## P5：Markdown 文件读取、保存与解析

目标：支持角色、核心文件、世界观、章节文件的真实读取与 Markdown 解析。

建议新增文件：

```text
backend/src/routes/files.ts
backend/src/modules/files/
  markdownParser.ts
  fileRepository.ts
  fileService.ts
```

接口：

- `GET /api/v1/books/:bookId/files`
- `GET /api/v1/books/:bookId/files/:fileId`
- `PUT /api/v1/books/:bookId/files/:fileId`
- `POST /api/v1/books/:bookId/files/upload`

主要任务：

- 读取 Markdown 原文。
- 解析 front matter、标题、列表、表格、引用、代码块。
- 生成 `parsedJson` 和摘要。
- 文件保存后更新 `contentHash`。
- 上传 world.md 或模板作品到 `imports/`。

验收标准：

- 作品详情 Markdown 弹窗可以读取真实文件。
- 修改 Markdown 后 hash 更新。
- 文件路径安全校验通过。

## P6：角色、势力、地点、物品实体管理

目标：把继续写作页中的角色、势力、地点、物品变成真实后端实体。

接口：

- `GET /api/v1/books/:bookId/entities?type=character`
- `POST /api/v1/books/:bookId/entities`
- `GET /api/v1/books/:bookId/entities/:entityId`
- `PATCH /api/v1/books/:bookId/entities/:entityId`
- `DELETE /api/v1/books/:bookId/entities/:entityId`

主要任务：

- 统一实体类型：`character`、`faction`、`location`、`item`。
- 每个实体同时写入 JSON 索引和 Markdown 文件。
- 角色支持主要/次要、性别、身份、当前状态。
- 势力支持名称、属性描述。
- 地点支持名称、描述、可用线索。
- 物品支持名称、描述、伏笔用途。

验收标准：

- 继续写作页新增势力、地点、物品能走后端保存。
- 角色列表能真实读取。
- 点击实体能读取对应 Markdown 内容。

## P7：模型配置与密钥管理

目标：用后端替换前端 localStorage 模型配置。

建议新增文件：

```text
backend/src/routes/models.ts
backend/src/modules/models/
  modelConfigRepository.ts
  modelRouteService.ts
  secretStore.ts
```

接口：

- `GET /api/v1/model-configs`
- `POST /api/v1/model-configs`
- `GET /api/v1/model-configs/:id`
- `PATCH /api/v1/model-configs/:id`
- `DELETE /api/v1/model-configs/:id`
- `POST /api/v1/model-configs/:id/default`
- `GET /api/v1/model-routes`
- `PUT /api/v1/model-routes/:routeKey`
- `GET /api/v1/model-analysis`

主要任务：

- 模型配置保存到 `index/model-configs.json`。
- API Key 不写入普通配置文件。
- API Key 加密保存到 `secrets/model-secrets.json`。
- 写作模型、审稿模型保存到 `index/model-routes.json`。
- 兼容前端 provider 枚举。
- 提供模型体系本地分析：检查配置完整度、启用状态、用途匹配、路由缺失和连接测试 adapter 覆盖。

验收标准：

- 模型配置页数据来自后端。
- 刷新页面配置不丢。
- 前端不再长期保存真实 API Key。
- 模型分析接口不读取密钥、不调用真实模型，空配置也能返回稳定诊断结果。

## P8：模型网关与连接测试

目标：建立统一模型调用入口，先支持 OpenAI Compatible、Ollama、DeepSeek。

建议新增文件：

```text
backend/src/modules/ai/
  modelGateway.ts
  adapters/
    openaiCompatibleAdapter.ts
    ollamaAdapter.ts
    deepseekAdapter.ts
  stream.ts
```

接口：

- `POST /api/v1/model-configs/test`

主要任务：

- 定义 `ModelProviderAdapter` TypeScript 接口。
- 使用 Vercel AI SDK `ai` 处理可兼容的流式输出。
- OpenAI Compatible 支持三方中转站。
- Ollama 默认支持 `http://127.0.0.1:11434/v1`。
- DeepSeek 支持官方 OpenAI 兼容接口。
- 连接测试不暴露 API Key。

验收标准：

- 模型配置页点击测试连接能返回真实状态。
- 失败时返回清晰错误原因。
- 三方中转站可通过 baseUrl + model 调通。

## P9：Agent Run 与 SSE 流式任务

目标：支持长任务运行记录和流式返回，为 AI 写作做基础。

建议新增文件：

```text
backend/src/routes/ai.ts
backend/src/modules/agents/
  runRepository.ts
  runService.ts
  sse.ts
  taskQueue.ts
```

接口：

- `GET /api/v1/runs/:runId`
- `GET /api/v1/runs/:runId/events`
- `POST /api/v1/runs/:runId/cancel`

主要任务：

- 每个 AI 任务生成 runId。
- 运行快照保存到 `books/{bookId}/runs/{runId}.json`。
- 全局追加日志写入 `index/runs.jsonl`。
- SSE 输出 `start`、`delta`、`tool`、`done`、`error`。
- 支持取消任务。

验收标准：

- 前端可以订阅 SSE。
- 页面刷新后仍能查询 run 结果。
- 异常任务有错误记录。

## P10：新建作品 AI 初始化

目标：作品创建后，支持 AI 自动补全未填写字段和核心文件。

接口：

- `POST /api/v1/books/:bookId/initialize`

主要任务：

- 读取用户已填写字段。
- 读取上传 world.md。
- 组装初始化 prompt。
- 调用规划模型生成作品简报、世界观、卷纲、角色初稿、当前状态、伏笔池。
- 每个阶段保存结构化 artifact 和可恢复 checkpoint，一致性审查只允许无阻断问题的 Bundle 进入写入阶段。
- 一致性审查通过后自动写入 Markdown、作品 JSON 和实体文件；写入前校验用户数据是否在生成期间发生变化，并保存初始化备份。
- 写入中失败或取消时执行文件索引、核心 Markdown、作品记录和实体存储的补偿回滚；不可逆提交完成后到达的取消请求按已完成处理。

验收标准：

- 空字段能生成建议值。
- `brief.md`、`outline.md`、`world.md` 等能生成完整初始化内容。
- 用户已填写字段和权威来源不会被静默覆盖；生成期间发生修改时停止自动写入。

## P11：继续写作与章节生成

目标：继续写作页可以基于真实作品上下文生成章节草稿。

接口：

- `POST /api/v1/books/:bookId/chapters`
- `GET /api/v1/books/:bookId/chapters`
- `GET /api/v1/books/:bookId/chapters/:chapterId`
- `PUT /api/v1/books/:bookId/chapters/:chapterId`
- `POST /api/v1/books/:bookId/chapters/:chapterId/continue`

主要任务：

- 章节文件保存到 `chapters/chapter-xxxx.md`。
- 继续写作时读取 brief、outline、world、current、foreshadowing、相关实体和当前章节。
- 先生成小纲，再生成正文。
- 支持流式返回。
- 用户确认后写入章节。
- 更新已写字数、已写章节、当前章节。

验收标准：

- 可创建章节。
- 可读取章节正文。
- AI 续写结果能进入草稿。
- 采纳后作品进度更新。

## P12：审稿、去 AI 味和连续性检查

目标：建立写作质量闭环。

接口：

- `POST /api/v1/books/:bookId/chapters/:chapterId/review`
- `POST /api/v1/books/:bookId/chapters/:chapterId/polish`
- `POST /api/v1/ai/books/:bookId/consistency-check`

主要任务：

- 审稿输出结构化报告：连续性、人物一致性、世界观冲突、伏笔、节奏、重复表达。
- 去 AI 味输出风险点和改写建议。
- 连续性检查读取 state/current、foreshadowing、角色实体。
- 所有结果进入 run 快照和草稿，不直接覆盖正文。

验收标准：

- 审稿能输出可读报告。
- 去 AI 味能输出修改建议和改写稿。
- 连续性检查能指出至少基础冲突。

## P13：写作风格分析

目标：支持写作风格功能从模板作品生成风格参数。

接口：

- `POST /api/v1/writing-styles/analyze`
- `GET /api/v1/writing-styles`
- `POST /api/v1/writing-styles`
- `GET /api/v1/writing-styles/:styleId`

主要任务：

- 上传模板作品。
- 分析句长、段落长度、对白比例、常用意象、节奏、禁用表达。
- 生成风格 JSON 和 Markdown 摘要。
- 新建作品和继续写作可以引用风格 ID。

验收标准：

- 写作风格页面可以读取真实风格列表。
- AI 分析接口只返回预览结果，点击保存风格后才写入本地风格库。
- 新建作品下拉框可读取后端风格列表。

## P14：前端 API 替换与联调

目标：逐步把前端 mock API 替换为真实后端。

替换顺序：

1. 模型配置 `modelConfigApi.ts`。
2. 作品库列表和详情。
3. Markdown 文件读取。
4. 新建作品。
5. 继续写作页章节和实体。
6. AI run/SSE。

主要任务：

- 已在前端新增统一 API baseUrl 配置，默认指向 `http://127.0.0.1:8787/api/v1`，并统一拆包后端 `{ code, message, data }` 响应。
- 已把 `modelConfigApi.ts` 从浏览器 localStorage 替换为后端模型配置、模型路由、连接测试接口。
- 已新增 `workspaceApi.ts`，把后端作品、文件、角色实体 DTO 适配为作品库页面需要的展示结构。
- 已新增写作风格 API 适配层，支持从后端读取风格、创建风格和执行模板作品分析。
- 已修复新建作品世界观 md 上传流程，前端读取文件正文并随创建请求写入后端 `world.md`。
- 已修复写作风格分析/保存流程，`/writing-styles/analyze` 不再直接创建后端风格记录。
- 保留 mock fallback，后端不可用时页面仍能展示提示，避免白屏。

验收标准：

- 前端页面无需手动刷新即可看到后端保存的数据。
- 后端不可用时有错误提示，而不是白屏。
- 已验证 `pnpm --dir D:\Ideaproduct\ink-agent-studio\packages\studio typecheck` 通过。
- 已验证 `pnpm --dir D:\Ideaproduct\ink-agent-studio\packages\studio build` 通过。
- 已验证 `pnpm --dir D:\Ideaproduct\ink-agent-studio\backend typecheck` 和 `pnpm --dir D:\Ideaproduct\ink-agent-studio\backend test` 通过。

## P15：本地启动脚本与开发体验

目标：一键启动前端和后端。

建议修改：

- 根目录 `start-studio.ps1`
- 根目录 `start-studio.cmd`
- 可选新增 `package.json` workspace 脚本

主要任务：

- 检测 Node、pnpm。
- 后端端口默认 `8787`。
- 前端端口默认 `5173`。
- 启动后打开前端地址。
- 输出后端健康检查地址。

验收标准：

- 双击脚本能启动前端和后端。
- 控制台显示前后端地址。
- 后端启动失败时能看到原因。

## P16：可选增强

这些不建议第一版就做，但后续可以逐步加入：

- SQLite 本地索引和全文搜索。
- 向量库记忆检索。
- Redis 缓存和 BullMQ 队列。
- Docker Compose。
- 自动备份和作品导出 zip。
- 模型调用成本统计。（已完成：用户配置币种和每百万 Token 单价后，按 Run/尝试记录估算值；未配置价格时保持空值，不猜测供应商价格。）
- Prompt 版本对比和校准集评分。

## 推荐开发顺序

1. P0 后端工程骨架。
2. P1 本地工作区与文件系统基础。
3. P2 共享领域类型与 Zod Schema。
4. P7 模型配置与密钥管理。
5. P8 模型网关与连接测试。
6. P3 作品库列表与作品详情。
7. P4 新建作品与作品目录生成。
8. P5 Markdown 文件读取、保存与解析。
9. P6 角色、势力、地点、物品实体管理。
10. P9 Agent Run 与 SSE 流式任务。
11. P10 新建作品 AI 初始化。
12. P11 继续写作与章节生成。
13. P12 审稿、去 AI 味和连续性检查。
14. P13 写作风格分析。
15. P14 前端 API 替换与联调。
16. P15 本地启动脚本与开发体验。

优先把模型配置和作品库做实，再做 AI 生成。这样每一步都有可见进展，也能减少后续返工。
