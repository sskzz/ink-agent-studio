# Ink Agent Studio 后端开发实现方案

本文档基于当前前端的「作品库」和「模型配置」两条主流程整理。目标是按 InkOS 技术栈为后续 TypeScript 后端开发提供可执行的模块拆分、接口设计、数据存储设计、模型接入方案和 Agent 写作流水线方案。

当前前端仍为页面和 mock 数据阶段。后端第一版建议完全对齐 InkOS 的本地优先思路：TypeScript monorepo、Node.js 服务、Hono HTTP API、本地文件系统、JSON 规范状态和 Markdown 可读投影。后续需要多设备同步、高可用部署时，再增加 SQLite/PostgreSQL、Redis、对象存储和任务队列。

## 1. 后端目标

- 支持本地作品库：创建作品、读取作品详情、维护作品属性、章节、角色、势力、地点、物品、核心文件和世界观。
- 支持 Markdown 文件解析：读取、保存、渲染预览、提取标题/段落/表格/引用等结构化内容。
- 支持模型配置：保存模型服务商、Base URL、模型名、密钥、用途、默认模型、写作模型和审稿模型。
- 支持模型网关：统一调用 OpenAI、Anthropic、Gemini、DeepSeek、Qwen、本地 Ollama、OpenAI 兼容中转站等模型。
- 支持 Agent 创作流水线：作品初始化、风格分析、世界观生成、角色生成、细纲生成、续写、审稿、去 AI 味润色、连续性检查。
- 支持长任务运行记录：记录每次 AI 任务的输入、输出、模型、耗时、错误、人工采纳结果。
- 支持本地优先和可扩展：单机可直接运行，未来可无痛引入 Redis、消息队列、向量库和容器化部署。

## 2. 推荐技术栈

### 2.1 本地优先第一版：InkOS 同款主栈

- Node.js 22：与 InkOS 根项目 engines 对齐。
- pnpm workspace：前后端、核心能力和 CLI/工具包统一放入 monorepo。
- TypeScript：前后端共享类型、模型配置类型、作品状态类型。
- Hono：后端 HTTP API 框架，轻量、适合本地服务和未来边缘部署。
- `@hono/node-server`：本地 Node 服务启动入口。
- `tsx`：开发期直接运行 TypeScript 服务。
- `tsc`：生产构建与类型检查。
- Vercel AI SDK `ai`：统一接入 OpenAI Compatible、Anthropic、Gemini 等模型流式能力。
- 本地文件系统：保存作品 Markdown、章节、规范 JSON 状态和运行快照。
- JSON + Markdown 双层存储：JSON 是机器可读事实源，Markdown 是用户可读/可编辑投影。
- Server-Sent Events：AI 续写、审稿、分析任务的流式输出。
- Zod：请求参数、模型输出 JSON、配置文件 schema 校验。
- gray-matter + markdown 解析库：解析 front matter、标题、列表、表格和正文结构。
- Vitest：核心逻辑、提示词拼装、文件读写和模型适配器单元测试。

### 2.2 高可用/高性能扩展版

- SQLite：可选本地索引层，用于加速作品列表、运行记录和全文搜索，不作为第一版强依赖。
- PostgreSQL：多人协作、多设备同步或服务端部署时替代本地 JSON 索引。
- Redis：缓存作品索引、模型路由、运行状态、限流计数和分布式锁。
- BullMQ、RabbitMQ 或 Kafka：异步执行长任务、审稿任务、向量索引任务。
- MinIO 或 S3：保存大文件、模板作品、导入文件、导出包。
- pgvector、Milvus 或 Qdrant：作品记忆、长上下文检索、风格样本检索。
- Docker Compose：后续统一启动后端、Redis、向量库、模型网关和可选数据库。
- OpenTelemetry + Prometheus + Grafana：后续观测模型耗时、失败率、Token 消耗。

## 3. 目录建议

```text
backend/
  package.json               后端包脚本，dev/build/typecheck/test
  tsconfig.json              TypeScript 编译配置
  src/
    index.ts                 @hono/node-server 启动入口
    app.ts                   Hono app、CORS、错误处理、路由注册
    routes/                  REST/SSE 路由层
      books.ts               作品库接口
      files.ts               Markdown 文件接口
      models.ts              模型配置和模型路由接口
      ai.ts                  Agent 任务和流式事件接口
    modules/                 业务模块，尽量保持无框架依赖
      workspace/             工作区与本地路径管理
      books/                 作品属性、章节、实体、核心文件
      models/                模型配置、模型路由、连接测试
      ai/                    模型网关、Provider Adapter、流式输出
      agents/                Agent 流水线、任务编排、运行记录
      styles/                写作风格、模板作品分析、风格参数
      files/                 Markdown 上传、解析、预览、导入导出
      review/                审稿、去 AI 味、连续性检查、质量评分
    schemas/                 Zod schema，统一校验请求和本地 JSON
    prompts/                 默认提示词模板
    utils/                   通用响应、异常、加密、hash、时间、日志
    types/                   后端领域类型，可与前端共享或生成契约
  data/                      本地运行数据目录，可配置到 D 盘项目 data 下
```

### 3.1 模块归档与注释规范

后端代码必须按功能模块归档，方便后续维护、搜索和替换。禁止将 AI 调用、文件读写、作品逻辑、审稿逻辑混写在同一个文件中。

模块归档要求：

- `modules/ai/adapters`：只放 AI 模型 API 适配器，例如 OpenAI Compatible、Ollama、DeepSeek、Gemini、Anthropic、Qwen 等。
- `modules/ai/modelGateway.ts`：统一模型网关，负责路由模型、调用 adapter、处理 fallback、重试、Token 统计和统一错误。
- `modules/ai/stream.ts`：统一处理模型流式输出和 SSE 事件转换。
- `modules/agents`：只放 Agent 任务编排、运行状态、SSE、运行快照、取消任务等逻辑。
- `modules/review`：只放去 AI 味、审稿、连续性检查、质量评分、风险点提取等逻辑。
- `modules/books`：只放作品库、章节、角色、势力、地点、物品和作品进度相关逻辑。
- `modules/files`：只放 Markdown 上传、读取、保存、解析、摘要、hash 和路径安全校验。
- `modules/models`：只放模型配置、密钥管理、模型路由和模型连接测试。
- `schemas`：只放 Zod schema，所有接口入参和本地 JSON 文件都必须经过 schema 校验。
- `prompts`：只放 Prompt 模板，业务代码不得硬编码大段 Prompt。

中文注释要求：

- 所有模块入口文件必须用中文注释说明模块职责、边界和禁止放入的内容。
- 复杂函数必须用中文注释说明输入、输出、关键流程和失败恢复策略。
- 文件写入、密钥加密、模型调用、Prompt 拼装、去 AI 味规则、SSE 推送、并发控制必须写中文注释。
- 注释要解释业务原因和风险，不写机械注释。例如推荐写“先写临时文件再 rename，避免 JSON 写入中断导致索引损坏”，不推荐写“写入文件”。
- 如果某段代码只是临时 mock 或占位，必须用中文注释标记后续替换位置和真实接口方向。

## 4. 作品库全流程分析

### 4.1 当前前端流程

1. 作品库列表展示本地作品卡片。
2. 点击作品进入作品详情。
3. 作品详情展示作品属性、当前章节、已写字数、已写章节、角色列表、核心文件、世界观。
4. 点击角色、核心文件、世界观可以查看 Markdown 内容。
5. 点击「新建作品」进入作品创建表单。
6. 新建作品字段全部可选，不填时由 AI 后续生成。
7. 新建作品字段包括作品名称、题材、人称、频道、写作风格、主角性别、主角姓名、小说计划字数、每章节计划字数、作品简介、世界观 md 文件。
8. 点击作品详情中的「继续写作」进入继续写作页。
9. 继续写作页展示作品信息、正文、草稿、角色、背景、势力、地点、物品和核心文件入口。

### 4.2 已发现并修复的前端一致性问题

- 作品详情中的计划章节数与「小说计划字数 / 每章节计划字数」不一致，已同步修正为按计划字数推算。
- 继续写作页默认打开空的势力页面，已改为默认打开基础设置，避免用户进入后看到空状态。
- 继续写作页曾存在硬编码作品字数、章节和世界观文件的问题，现已改为根据来源作品 ID 读取后端作品详情；接口为空或读取失败时显示空状态。
- 模型配置前端服务商类型偏少，已补齐主流官方 API、本地模型和三方中转/网关入口。

### 4.3 后端需要补齐的流程能力

- 新建作品时生成真实作品目录。
- 新建作品后将作品写入本地 JSON 索引和作品目录，并生成默认 Markdown 文件。
- 所有可选字段留空时，由 AI 初始化任务补全。
- 作品详情从本地 JSON/Markdown 文件读取，而不是前端 mock。
- 继续写作页根据来源作品 ID 加载对应作品，不再硬编码具体作品名或示例作品内容。
- 角色、势力、地点、物品需要统一为「作品实体」模型，便于后续检索和 AI 引用。
- 核心文件需要统一索引：故事基石、卷纲规划、当前状态、伏笔池、世界观。
- Markdown 解析需要支持标题、列表、表格、引用、代码块和 front matter。

## 5. 本地作品目录设计

建议每个作品在本地拥有独立目录，JSON 保存索引和元信息，Markdown 文件保存可编辑内容。

```text
data/workspaces/default/books/{bookId}/
  book.json                     作品元信息快照
  brief.md                      故事基石
  outline.md                    总纲或卷纲规划
  world.md                      世界观
  chapters/
    chapter-0001.md
    chapter-0002.md
  entities/
    characters/
      lin-yan.md
    factions/
      old-port-post.md
    locations/
      pier-03.md
    items/
      wet-postmark.md
  state/
    current.md                  当前状态
    foreshadowing.md            伏笔池
    continuity.json             连续性状态缓存
  runs/
    {runId}.json                单次 AI 运行快照
  imports/
    worldview-upload.md
```

## 6. 数据模型与可选索引设计

采用 InkOS 技术栈后，第一版不把关系型数据库作为事实源。事实源使用本地 JSON + Markdown：JSON 保存机器可读状态，Markdown 保存用户可读内容。下面的 `books`、`book_files` 等不是强制 SQL 表，而是本地 JSON 集合和未来可选 SQLite/PostgreSQL 投影层的统一数据模型。

建议第一版落盘方式：

- `data/workspaces/default/index/books.json`：作品列表索引。
- `data/workspaces/default/index/model-configs.json`：模型配置索引，不保存明文密钥。
- `data/workspaces/default/index/model-routes.json`：写作、审稿、规划等模型路由。
- `data/workspaces/default/index/runs.jsonl`：运行记录追加日志，便于本地恢复和调试。
- `data/workspaces/default/secrets/model-secrets.json`：加密后的 API Key，可用 Node `crypto` 基于本机密钥派生加密。
- `data/workspaces/default/books/{bookId}/book.json`：单本作品规范状态。

后续如果作品数量很大或需要多用户部署，再将这些 JSON 集合投影到 SQLite/PostgreSQL。字段中的 `*_json` 在 JSON 文件中直接保存对象，在 SQL 投影层中可存为 TEXT/JSONB。

### 6.1 books

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | varchar | 作品 ID |
| title | varchar | 作品名称，可由 AI 生成 |
| genre | varchar | 题材 |
| status | varchar | planning、drafting、reviewing、paused |
| narration_perspective | varchar | 第一人称、第三人称 |
| channel | varchar | 男频、女频 |
| writing_style_id | varchar | 写作风格 ID |
| protagonist_gender | varchar | 主角性别 |
| protagonist_name | varchar | 主角姓名 |
| planned_words | integer | 小说计划字数 |
| chapter_words | integer | 每章节计划字数 |
| written_words | integer | 已写字数 |
| written_chapters | integer | 已写章节 |
| current_chapter_id | varchar | 当前章节 ID |
| world_file_id | varchar | 世界观文件 ID |
| metadata_json | text | 扩展属性 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### 6.2 book_files

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | varchar | 文件 ID |
| book_id | varchar | 所属作品 |
| file_type | varchar | brief、outline、world、current_state、foreshadowing、chapter、entity |
| title | varchar | 展示标题 |
| path | varchar | 本地相对路径 |
| summary | text | 文件摘要 |
| content_hash | varchar | 内容哈希，用于检测变更 |
| parsed_json | text | Markdown 解析结果缓存 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### 6.3 book_entities

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | varchar | 实体 ID |
| book_id | varchar | 所属作品 |
| entity_type | varchar | character、faction、location、item |
| name | varchar | 名称 |
| role | varchar | 主要、次要、组织、地点、物品等 |
| description | text | 描述 |
| file_id | varchar | 对应 Markdown 文件 |
| attributes_json | text | 性别、身份、能力、关系等扩展属性 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### 6.4 chapters

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | varchar | 章节 ID |
| book_id | varchar | 所属作品 |
| volume_no | integer | 卷序号 |
| chapter_no | integer | 章节序号 |
| title | varchar | 章节标题 |
| file_id | varchar | 对应 Markdown 文件 |
| word_count | integer | 字数 |
| status | varchar | planned、drafting、reviewed、published |
| outline | text | 章节细纲 |
| summary | text | 章节摘要 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### 6.5 model_configs

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | varchar | 配置 ID |
| name | varchar | 配置名称 |
| provider | varchar | 服务商类型 |
| protocol | varchar | openai_chat、openai_responses、anthropic_messages、gemini、custom |
| base_url | varchar | Base URL |
| model | varchar | 模型名 |
| api_key_cipher | text | 加密后的 API Key |
| purpose | varchar | planning、writing、review、embedding、image |
| enabled | boolean | 是否启用 |
| is_default | boolean | 是否默认 |
| capabilities_json | text | 支持流式、工具调用、视觉、最大上下文等 |
| note | text | 备注 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### 6.6 model_routes

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | varchar | 路由 ID |
| route_key | varchar | writing、review、planning、style_analyze、anti_ai_polish |
| model_config_id | varchar | 使用的模型配置 |
| fallback_model_config_id | varchar | 备用模型 |
| enabled | boolean | 是否启用 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### 6.7 agentRuns

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | varchar | 运行 ID |
| book_id | varchar | 所属作品 |
| run_type | varchar | create_book、continue_writing、review、style_analyze、anti_ai_polish |
| status | varchar | queued、running、completed、failed、cancelled |
| input_json / inputJson | text/object | 输入快照 |
| output_json / outputJson | text/object | 输出快照 |
| model_config_id | varchar | 使用模型 |
| prompt_version | varchar | 提示词版本 |
| token_usage_json / tokenUsageJson | text/object | Token 消耗 |
| error_message | text | 错误 |
| started_at | datetime | 开始时间 |
| finished_at | datetime | 结束时间 |

### 6.8 promptTemplates

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | varchar | 模板 ID |
| name | varchar | 模板名称 |
| task_type | varchar | 任务类型 |
| version | varchar | 版本 |
| content | text | 提示词正文 |
| variables_json | text | 变量定义 |
| enabled | boolean | 是否启用 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

## 7. API 设计

统一前缀建议为 `/api/v1`。返回结构建议统一：

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

### 7.1 作品库接口

- `GET /api/v1/books`：作品列表。
- `POST /api/v1/books`：创建作品，字段全部可选。
- `GET /api/v1/books/{bookId}`：作品详情，包含属性、进度、角色、核心文件、世界观。
- `PATCH /api/v1/books/{bookId}`：修改作品属性。
- `DELETE /api/v1/books/{bookId}`：删除作品，可提供是否保留本地文件选项。
- `POST /api/v1/books/{bookId}/initialize`：AI 补全作品基础设定，生成 brief、outline、world、角色初稿。
- `GET /api/v1/books/{bookId}/files`：读取文件索引。
- `GET /api/v1/books/{bookId}/files/{fileId}`：读取 Markdown 文件内容和解析结果。
- `PUT /api/v1/books/{bookId}/files/{fileId}`：保存 Markdown 文件。
- `POST /api/v1/books/{bookId}/files/upload`：上传 world.md 或模板作品。

### 7.2 作品实体接口

- `GET /api/v1/books/{bookId}/entities?type=character`：读取角色、势力、地点、物品。
- `POST /api/v1/books/{bookId}/entities`：新增实体。
- `GET /api/v1/books/{bookId}/entities/{entityId}`：实体详情。
- `PATCH /api/v1/books/{bookId}/entities/{entityId}`：修改实体。
- `DELETE /api/v1/books/{bookId}/entities/{entityId}`：删除实体。
- `POST /api/v1/books/{bookId}/entities/generate`：AI 生成角色/势力/地点/物品草稿。

### 7.3 章节接口

- `GET /api/v1/books/{bookId}/chapters`：章节列表。
- `POST /api/v1/books/{bookId}/chapters`：新增章节。
- `GET /api/v1/books/{bookId}/chapters/{chapterId}`：章节详情。
- `PUT /api/v1/books/{bookId}/chapters/{chapterId}`：保存章节正文。
- `POST /api/v1/books/{bookId}/chapters/{chapterId}/continue`：AI 续写章节。
- `POST /api/v1/books/{bookId}/chapters/{chapterId}/review`：AI 审稿。
- `POST /api/v1/books/{bookId}/chapters/{chapterId}/polish`：去 AI 味润色。

### 7.4 模型配置接口

- `GET /api/v1/model-configs`：模型配置列表。
- `POST /api/v1/model-configs`：新增模型配置。
- `GET /api/v1/model-configs/{id}`：模型配置详情。
- `PATCH /api/v1/model-configs/{id}`：修改模型配置。
- `DELETE /api/v1/model-configs/{id}`：删除模型配置。
- `POST /api/v1/model-configs/{id}/default`：设置默认模型。
- `POST /api/v1/model-configs/test`：测试模型连通性。
- `GET /api/v1/model-analysis`：模型体系本地分析，返回健康分、路由状态、参数风险、adapter 覆盖和优化建议；不读取 API Key，不真实调用模型。
- `GET /api/v1/model-routes`：读取写作、审稿、规划等模型路由。
- `PUT /api/v1/model-routes/{routeKey}`：设置某个任务使用的模型。

### 7.5 AI 任务接口

- `POST /api/v1/ai/style/analyze`：分析模板作品，生成写作风格参数。
- `POST /api/v1/ai/books/{bookId}/plan`：生成或修订作品规划。
- `POST /api/v1/ai/books/{bookId}/continue`：基于当前上下文续写。
- `POST /api/v1/ai/books/{bookId}/review`：全书或章节审稿。
- `POST /api/v1/ai/books/{bookId}/anti-ai-polish`：去 AI 味润色。
- `POST /api/v1/ai/books/{bookId}/consistency-check`：连续性检查。
- `POST /api/v1/ai/books/{bookId}/extract-entities`：从文本中提取角色、势力、地点、物品。
- `GET /api/v1/runs/{runId}`：读取运行状态。
- `GET /api/v1/runs/{runId}/events`：SSE 流式事件。
- `POST /api/v1/runs/{runId}/cancel`：取消运行。

## 8. 模型接入方案

### 8.1 Provider Adapter 抽象

后端不要让业务代码直接调用某个厂商 SDK。建议在 TypeScript 层建立统一接口；能用 Vercel AI SDK `ai` 统一处理的服务商走 SDK，特殊协议再写独立 adapter。

```ts
export interface ModelProviderAdapter {
  providerType: ProviderType;
  test(config: ModelConfig): Promise<ModelTestResult>;
  chat(request: ModelRequest): Promise<ModelResponse>;
  streamChat(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
  listModels(config: ModelConfig): Promise<ModelInfo[]>;
}
```

核心统一字段：

- provider：服务商类型。
- protocol：协议类型。
- baseUrl：调用地址。
- apiKey：运行时解密注入。
- model：模型名。
- messages：system、developer、user、assistant。
- responseFormat：text、json、markdown。
- stream：是否流式。
- tools：后续工具调用预留。

### 8.2 主流官方 API 模型入口

前端已预留以下 provider 类型，后端按适配器逐步实现：

| Provider | 协议建议 | 用途建议 |
| --- | --- | --- |
| OpenAI | OpenAI Responses 或 Chat Completions | 高质量规划、写作、审稿、结构化输出 |
| Azure OpenAI | Azure OpenAI Chat/Responses | 企业部署、内网合规 |
| Anthropic Claude | Anthropic Messages | 长上下文审稿、风格分析、复杂规划 |
| Google Gemini | Gemini Generate Content | 长上下文、多模态、文件分析 |
| DeepSeek | OpenAI 兼容 Chat | 高性价比写作、推理、规划 |
| Qwen / DashScope | OpenAI 兼容或 DashScope 原生 | 中文写作、摘要、结构化生成 |
| Moonshot / Kimi | OpenAI 兼容 Chat | 长上下文阅读、资料分析 |
| 智谱 GLM | OpenAI 兼容或官方 SDK | 中文任务、结构化生成 |
| 豆包 / 火山方舟 | OpenAI 兼容或火山方舟协议 | 中文生成、低延迟服务 |
| 百川智能 | 官方 API 或兼容协议 | 中文生成 |
| 百度千帆 | 千帆 API | 中文生成、企业云服务 |
| 腾讯混元 | 混元 API | 中文生成、企业云服务 |
| MiniMax | 官方 API | 中文创作、角色对话 |
| Mistral AI | 官方 API 或 OpenAI 兼容 | 多语言、开放模型生态 |
| xAI | OpenAI 兼容 | Grok 系列模型 |
| Cohere | 官方 API | 生成、向量、重排 |

原则：后端不要硬编码最新模型名。模型名允许用户填写，也可通过 `listModels` 动态读取并缓存。

### 8.3 三方中转站和自建网关

需要单独保留三方中转站接入能力，原因是用户可能使用 One API、LiteLLM、OpenRouter、公司内部网关或其他 OpenAI 兼容服务。

建议 provider 类型：

- `openai-compatible`：通用 OpenAI 兼容协议。
- `openrouter`：OpenRouter 聚合服务。
- `oneapi`：One API 自建或三方中转。
- `litellm`：LiteLLM 自建模型网关。
- `custom`：未知服务商，用户手动填写协议、Headers 和路径。

中转站配置需要支持：

- 自定义 Base URL。
- 自定义 Authorization Header。
- 自定义额外 Headers。
- 模型名手动填写。
- 流式开关。
- 请求路径覆盖，例如 `/chat/completions` 或 `/responses`。
- 失败 fallback，例如中转站失败后切回本地模型。

### 8.4 本地模型服务

建议第一版支持：

- Ollama：默认 `http://127.0.0.1:11434/v1`，OpenAI 兼容。
- LM Studio：默认本地 OpenAI 兼容地址。
- vLLM：适合本机或局域网高性能推理。

本地模型适合：

- 草稿初筛。
- 连续性检查。
- 字数统计、实体提取、摘要。
- 非敏感文本处理。

不建议第一版强依赖本地模型完成高质量长篇正文生成。可将本地模型作为审稿、校验、提取和 fallback。

## 9. Agent 写作流水线

### 9.1 新建作品初始化

输入：用户填写的可选字段、上传的 world.md、写作风格选择。

步骤：

1. 规范化用户输入，空字段标记为 `needs_ai_fill`。
2. 如果上传 world.md，解析 Markdown 并生成摘要。
3. 调用规划模型生成作品简报 `brief.md`。
4. 生成世界观 `world.md` 或合并用户上传文件。
5. 生成卷纲 `outline.md`。
6. 生成初始角色、势力、地点、物品。
7. 生成当前状态 `state/current.md`。
8. 生成伏笔池 `state/foreshadowing.md`。
9. 写入本地 JSON 索引、作品规范状态和 Markdown 文件。
10. 记录 agent_run。

### 9.2 继续写作

输入：bookId、chapterId、用户写作目标、选中的上下文文件。

上下文组装顺序：

1. 系统约束：安全边界、禁止胡编规则、输出格式。
2. 写作风格：风格参数、句式节奏、禁用表达。
3. 作品基石：brief.md。
4. 当前卷纲：outline.md。
5. 当前状态：state/current.md。
6. 伏笔池：state/foreshadowing.md。
7. 角色、势力、地点、物品的相关片段。
8. 当前章节已写内容。
9. 用户本次指令。

生成步骤：

1. 规划模型生成本次续写小纲。
2. 写作模型生成正文草稿。
3. 审稿模型检查设定一致性、重复表达和 AI 味。
4. 去 AI 味模型或同一审稿模型进行修订。
5. 输出差异对比，等待用户采纳。
6. 用户采纳后写入章节文件，更新字数和状态。

### 9.3 审稿

审稿报告建议包含：

- 情节连续性问题。
- 人物行为是否符合设定。
- 世界观规则是否冲突。
- 伏笔投放和回收是否合理。
- 重复表达、模板句式、空泛形容词。
- 节奏问题。
- 字数、段落、对白比例。
- 修改建议。

### 9.4 去 AI 味实现方案

需要明确一点：无法保证文本被任何检测器判定为「非 AI」。后端目标应定义为降低模板化、空泛化和同质化，让文本更接近用户设定的风格。

实现策略：

- 风格样本分析：从用户模板作品中提取句长分布、段落长度、对白比例、常用动词、意象、叙事节奏。
- 禁用清单：记录用户不想要的 AI 常见表达，例如过度总结、抽象情绪词、机械转折句。
- 细节优先：要求模型用动作、物件、环境变化承载情绪，不直接解释人物心理。
- 分层改写：先改结构，再改段落，再改句子，避免一次性大改导致风格漂移。
- 反模板审稿：审稿模型输出「AI 味风险点」和替换建议。
- 用户偏好记忆：记录用户采纳和拒绝的改写片段，后续作为偏好样本。
- 对照校准：同一段文本保留原稿、AI 初稿、去 AI 味稿、人工最终稿，定期生成偏好报告。

建议评分维度：

| 维度 | 说明 |
| --- | --- |
| 具体性 | 是否有可感知细节，而不是抽象形容 |
| 人物一致性 | 行动和台词是否符合角色设定 |
| 句式变化 | 长短句、对白、动作句是否有变化 |
| 信息密度 | 是否每段推进信息、情绪或伏笔 |
| 风格贴合 | 是否贴近选定写作风格 |
| 重复风险 | 是否重复同类句式、意象、转折 |

## 10. 提示词调教、校准和约束

### 10.1 提示词版本化

所有核心提示词进入 `data/workspaces/default/index/prompt-templates.json` 和 `src/prompts` 文件夹。每次修改提示词都生成版本号。

推荐模板：

- `book.initialize.v1`
- `style.analyze.v1`
- `chapter.plan.v1`
- `chapter.write.v1`
- `chapter.review.v1`
- `chapter.anti_ai_polish.v1`
- `entity.extract.v1`
- `continuity.check.v1`

### 10.2 输出结构约束

需要结构化结果时，优先要求 JSON 输出，并做后端校验：

- 缺字段则重试一次。
- JSON 解析失败则进入修复提示词。
- 超出枚举值则回退默认值。
- 文件路径、ID、类型由后端生成，禁止模型自由生成系统路径。

### 10.3 校准集

建议准备本地校准集：

- 3 到 5 个作品样例。
- 每个样例包含 brief、outline、world、角色、章节原文、人工满意稿。
- 每次更换模型或提示词，运行校准任务，比较评分。

### 10.4 审核与安全边界

- API Key 只在后端加密保存，前端不长期保存。
- AI 输出不直接覆盖用户正文，必须进入草稿或 diff。
- 文件写入前检查路径是否在工作区内，禁止路径穿越。
- 模型错误、超时、限流要记录到 agent_runs。
- 支持用户一键回滚上一次采纳。

## 11. Markdown 分析方案

### 11.1 解析能力

- 标题层级。
- 列表。
- 表格。
- 引用。
- 代码块。
- Front matter。
- 字数统计。
- 摘要生成。
- 锚点索引。

### 11.2 文件分析任务

- `brief.md`：提取卖点、读者承诺、禁用方向。
- `outline.md`：提取卷、章节、关键转折和伏笔回收点。
- `world.md`：提取世界规则、地点、限制条件。
- `characters/*.md`：提取角色姓名、身份、目标、关系、禁用写法。
- `state/current.md`：提取已公开信息、未公开信息、下一章目标。
- `state/foreshadowing.md`：提取伏笔、投放章节、回收章节。

解析结果写入本地文件索引中的 `parsedJson` 字段，未来接入 SQL 投影层时可对应到 `book_files.parsed_json`，用于继续写作的上下文检索。

## 12. 性能与高可用设计

### 12.1 第一版

- 本地 JSON 索引 + Markdown 文件系统作为事实源，不强制引入数据库。
- AI 长任务使用内存运行态 + `runs.jsonl` 追加日志 + SSE 流式事件。
- 本地文件读取加入内容哈希，未变化不重复解析。
- 模型配置和路由缓存到内存，修改 JSON 后刷新缓存。
- 对作品目录写入使用单进程文件锁或队列串行化，避免同一本作品并发覆盖。
- API 响应先读取索引文件，详情页再懒加载 Markdown 内容，保证本地页面打开速度。

### 12.2 扩展版

- Redis 缓存作品索引、文件摘要、模型列表。
- BullMQ、RabbitMQ 或 Kafka 承载长任务。
- SQLite 作为本地可选投影层，加速搜索和运行记录查询。
- PostgreSQL 存储服务端部署时的业务索引，JSON/Markdown 仍可保留为导入导出格式。
- 向量库做章节、角色、设定检索。
- 多实例部署时使用 Redis 分布式锁，避免多个 worker 同时写同一作品文件。
- 文件存储从本地切换为 MinIO/S3，索引层只存路径、hash 和解析摘要。

## 13. 里程碑建议

### M1：后端基础骨架

- `backend/package.json` 初始化，脚本包含 `dev`、`build`、`typecheck`、`test`。
- Hono app、`@hono/node-server` 启动入口、CORS、统一响应、异常处理。
- TypeScript 路径别名、Zod schema、Vitest 测试骨架。
- 本地工作区路径配置。
- 健康检查接口。

### M2：作品库落地

- 作品 CRUD。
- 作品目录生成。
- Markdown 上传、读取、保存、解析。
- 作品详情接口对接前端。
- `books.json`、`book.json`、`book_files` 索引读写。

### M3：模型配置落地

- 模型配置 CRUD。
- API Key 加密保存。
- 写作模型、审稿模型路由。
- 模型连接测试。
- OpenAI Compatible、Ollama、DeepSeek 第一批适配器。
- 基于 Vercel AI SDK `ai` 封装统一流式输出。

### M4：AI 创作任务

- `runs.jsonl` 运行记录和 `runs/{runId}.json` 快照。
- SSE 流式输出。
- 新建作品 AI 初始化。
- 章节续写。
- 审稿与去 AI 味润色。

### M5：质量与扩展

- 提示词版本化。
- 校准集与评分。
- Redis/队列可选接入。
- 向量检索接入。
- Docker Compose 一键启动。

## 14. 前后端对齐提醒

- 前端 `modelOptions.ts` 的 provider 枚举要与后端 `ProviderType` 保持一致。
- 前端作品属性字段要与后端 `BookRecord` / `book.json` schema 保持一致。
- 继续写作页必须通过 `fromBookId` 或路由参数读取对应作品，后端不要返回固定 mock。
- 所有 Markdown 弹窗和查看页统一走 `bookFiles` / `/files` 接口。
- AI 生成结果不要直接覆盖文件，先进入草稿、diff 或待确认状态。

## 15. 官方文档参考

- OpenAI Models: https://platform.openai.com/docs/models
- Anthropic Models: https://docs.anthropic.com/en/docs/about-claude/models/overview
- Google Gemini Models: https://ai.google.dev/gemini-api/docs/models
- DeepSeek API Docs: https://api-docs.deepseek.com/
- Ollama OpenAI compatibility: https://docs.ollama.com/openai
- OpenRouter API Docs: https://openrouter.ai/docs
- LiteLLM Providers: https://docs.litellm.ai/docs/providers
