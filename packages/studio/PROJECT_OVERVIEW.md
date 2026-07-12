# Ink Agent Studio 前端项目说明

本文档用于记录前端项目的当前设计、目录结构、页面能力和后续维护约定。后续每次调整页面、目录、配置、接口预留点或核心交互时，都需要同步更新本文档，避免项目越迭代越难接手。

## 项目定位

Ink Agent Studio 是一个本地优先的 Agent 创作系统前端。当前阶段只实现前端页面、模拟数据和接口调用预留位置，不直接落盘、不真正调用模型、不保存真实 API Key。

第一版重点目标：

- 搭建作品库、作品详情、继续写作、写作风格、模型配置等核心页面。
- 以本地优先为前提，后续按 InkOS 技术栈接入 TypeScript/Hono 后端、本地文件系统、模型网关和 Agent 写作流水线。
- 页面风格参考 AI-Novel-Writing-Assistant 的浅色控制台方向，采用白底卡片、细边框、低阴影、紧凑字号和轻量流程动效，强调清晰、年轻化、响应式稳定。

## 技术栈

- React 19：负责页面组件和交互。
- TypeScript：保证前端类型安全。
- Vite：负责本地开发服务和生产构建。
- React Router：负责页面路由。
- Zustand：负责轻量前端状态管理。
- TanStack Query：预留服务端数据请求管理能力。
- lucide-react：提供侧边栏和页面图标。

## 当前目录结构

```text
src/
  app/                         应用入口、路由壳和全局客户端配置
    App.tsx                    路由注册
    queryClient.ts             TanStack Query 客户端
    shell/AppShell.tsx         全局布局、侧边栏、顶部栏
  config/                      配置类常量，页面组件不直接硬编码
    modelOptions.ts            模型服务商、模型用途、用途显示名
    navigation.ts              侧边栏导航、应用壳文案
  features/                    业务功能页面，按功能域拆分
    agent/pages/               Agent 控制台页面
    dashboard/pages/           总览页面
    editor/pages/              继续写作页面
    models/pages/              模型配置页面
    runs/pages/                运行记录页面
    settings/pages/            设置页面
    state/pages/               世界状态页面
    workspace/pages/           作品库、作品详情、新建作品页面
    writing-styles/            写作风格功能
      api/                     写作风格后端 API 适配层
      data/                    写作风格示例数据和类型
      pages/                   写作风格页面
  shared/                      跨功能复用能力
    api/                       前端 API 适配层、统一 HTTP 封装、模型配置与作品库接口
    components/ui/             通用 UI 组件
    stores/                    Zustand 状态
    styles/global.css          全局样式
    types/domain.ts            跨功能领域类型
  main.tsx                     前端挂载入口
```

## 页面能力

- 总览：展示当前创作系统入口和状态概览。
- 作品库：展示作品列表、新建作品入口、作品详情；当前已优先读取后端 `/api/v1/books`，并通过 `workspaceApi.ts` 适配 Markdown 文件、角色实体和作品属性展示。
- 作品详情：展示作品信息、作品属性、当前章节、已写字数、已写章节、角色列表、核心文件和世界观。角色、核心文件、世界观支持 Markdown 弹窗渲染。
- 继续写作：只能从作品详情的“继续写作”按钮进入。当前已改为沉浸式小说编辑器布局，隐藏项目级侧边栏和顶部状态栏；页面包含顶部作品状态栏、左侧“作品信息 / 正文 / 草稿”导航、中间属性/章节编辑面板、右侧“灵感卡片 / AI对话”面板。进入编辑器时会记录来源作品 ID，顶部作品状态和基础设置会轻量读取后端作品详情，左上角“退出”会返回对应作品详情页；章节正文、实体详情和 AI 对话仍是后续接入范围。
- 写作风格：包含风格列表、新增风格、风格详情；当前已接入后端 `/api/v1/writing-styles` 和 `/api/v1/writing-styles/analyze`，分析仍为后端第一版确定性模拟结果。
- 模型配置：包含模型类型入口、模型分析卡、模型列表、写作模型选择、审稿模型选择、模型详情表单。当前已通过 `modelConfigApi.ts` 接入后端模型配置、模型路由、连接测试和模型体系分析接口；服务商选项已覆盖 OpenAI、Azure OpenAI、Anthropic、Gemini、DeepSeek、Qwen、Moonshot、智谱、豆包、百川、百度千帆、腾讯混元、MiniMax、Mistral、xAI、Cohere、本地 Ollama/LM Studio/vLLM，以及 OpenRouter、One API、LiteLLM 等三方中转或自建网关。
- Agent 控制台、世界状态、运行记录、设置：当前为页面占位，后续按功能逐步补齐。

## 配置维护约定

- 新增侧边栏功能入口：优先修改 `src/config/navigation.ts`。
- 新增模型服务商、模型用途：优先修改 `src/config/modelOptions.ts`。
- 新增通用 UI：放入 `src/shared/components/ui`。
- 新增业务页面：放入对应 `src/features/<feature>/pages`。
- 新增跨页面类型：放入 `src/shared/types/domain.ts`；仅单功能使用的类型优先放在对应 feature 内部。
- 新增接口适配：放入 `src/shared/api`，页面不要直接写 `fetch`。

## 接口预留说明

当前前端已完成 P14 基础 API 替换与联调：模型配置、作品库、新建作品和写作风格优先调用后端 `/api/v1`。开发环境默认通过 Vite `/api` 代理访问后端，避免前端端口从 5173 漂移到 5175 时触发 CORS；后端也允许 `127.0.0.1` / `localhost` 的本地开发来源。后端不可用、接口返回空数组或详情读取失败时，页面只显示空状态或错误提示，不再回退到前端示例数据，避免接口真实状态被死数据掩盖。

当前已接入的主要后端接口：

- `GET /api/v1/model-configs`：读取模型配置列表。
- `POST /api/v1/model-configs` / `PATCH /api/v1/model-configs/:id`：新增或更新模型配置。
- `DELETE /api/v1/model-configs/:id`：删除模型配置。
- `POST /api/v1/model-configs/:id/default`：设置默认模型。
- `POST /api/v1/model-configs/test`：测试模型连通性。
- `GET /api/v1/model-analysis`：读取模型配置健康度、路由就绪度、参数风险和优化建议；该接口只做本地确定性分析，不读取 API Key，也不真实调用模型。
- `GET /api/v1/model-routes` / `PUT /api/v1/model-routes/:routeKey`：读取和更新写作/审稿模型路由。
- `GET /api/v1/books`：读取本地作品列表。
- `POST /api/v1/books`：创建本地作品目录和基础 Markdown 文件；新建作品表单会读取上传的世界观 md 正文并写入 `world.md`。
- `GET /api/v1/books/:id`：读取作品详情和 Markdown 文件索引。
- `GET /api/v1/books/:bookId/files/:fileId`：读取作品详情弹窗需要的 Markdown 正文。
- `GET /api/v1/books/:bookId/entities?type=character`：读取作品角色列表。
- `GET /api/v1/writing-styles` / `POST /api/v1/writing-styles`：读取和创建写作风格。
- `POST /api/v1/writing-styles/analyze`：分析模板作品并返回分析预览，不直接写入风格库；用户点击“保存风格”后才持久化。

## 后端方案文档

后端开发实现方案已整理到项目根目录的 `backend/BACKEND_IMPLEMENTATION_PLAN.md`。该文档已同步为 InkOS 技术栈方向：Node.js 22、pnpm workspace、TypeScript、Hono、`@hono/node-server`、Vercel AI SDK、本地 JSON/Markdown 事实源、REST/SSE 接口、模型 Provider Adapter、三方中转站接入、Agent 写作流水线、Markdown 解析、去 AI 味约束、提示词调教与高可用扩展方案。

后端逐步开发计划已整理到 `backend/BACKEND_STEP_BY_STEP_PLAN.md`。后续真正开始写后端时，应优先按该计划从 P0 后端工程骨架、P1 本地工作区、P2 Zod Schema、P7 模型配置、P8 模型网关开始推进，再逐步接入作品库、Markdown、Agent Run 和 AI 写作能力。

后端开发必须遵守模块归档和中文注释规范：AI 模型 API 放入 `modules/ai/adapters`，模型网关放入 `modules/ai`，去 AI 味和审稿放入 `modules/review`，作品、文件、模型配置分别放入对应模块；复杂业务、文件写入、模型调用、Prompt 拼装和错误恢复逻辑必须写清晰中文注释。

当前后端已开始按计划执行：P0 Hono 工程骨架、P1 本地工作区与安全文件工具、P2 基础领域类型和 Zod Schema、P7 模型配置与密钥管理、P8 模型网关与连接测试第一版、P8+ 模型体系本地分析、P3 作品库列表与详情、P4 新建作品与目录生成、P5 Markdown 文件读取保存解析、P6 角色/势力/地点/物品实体管理、P9 Agent Run/SSE、P10-P12 AI 初始化/续写/审稿/去 AI 味占位实现、P13 写作风格接口、P14 前端 API 基础替换与联调已落地，并已通过前端 typecheck/build 与后端 typecheck/test。下一步优先细化 P15 启动体验，并继续把继续写作页章节、实体管理、AI run/SSE 接入后端。

根目录启动脚本已接入后端：普通使用优先运行 `start-studio.cmd`，它会自动携带 `-NoProfile -ExecutionPolicy Bypass -File` 等 PowerShell 参数并调用 `start-studio.ps1`；`start-studio.ps1` 会先检查/安装 workspace 依赖，再后台启动 `backend/start-backend.ps1`，后端默认运行在 `http://127.0.0.1:8787`，前端继续以前台方式运行在 `http://127.0.0.1:5173`，如端口占用则由 Vite 自动切换到 5174/5175 等可用端口。PowerShell 启动脚本保持 ASCII-only，避免 Windows PowerShell 读取无 BOM UTF-8 中文字符串时出现解析错误。

## 样式约定

- 全局样式集中在 `src/shared/styles/global.css`。
- 当前视觉方向为参考 AI-Novel-Writing-Assistant 与在线小说编辑器的浅色编辑台样式：页面背景保持浅灰蓝，核心内容使用白底区域、细边框、低阴影和紧凑信息密度，避免厚重玻璃拟态和大面积高饱和背景。
- 当前页面美化在 `global.css` 末尾保留一层高优先级覆盖：页面头部、摘要卡、模型分析卡、模型/作品/风格卡片统一使用浅色玻璃砂质感、柔和渐变、细边框、低阴影和轻量悬停上浮。
- 全局字体以 `HarmonyOS Sans SC`、`MiSans`、`Alibaba PuHuiTi 3.0` 为优先字体，并保留 `PingFang SC`、`Microsoft YaHei UI` 等中文字体回退。
- 全局按钮使用深色主按钮和浅灰辅助按钮，避免纯白无边界按钮。
- 页面切换、卡片悬停和功能入口保留轻量动效，动效以快速、克制、不影响阅读为原则。
- 页面要保证浏览器缩放、窄屏和长文本情况下不出现横向溢出。
- 继续写作页右侧 AI 面板可通过边缘小箭头按钮收起或展开，展开态按钮位于主内容和右侧面板之间，收起态按钮固定紧贴浏览器右侧边缘。
- 继续写作页整体固定为不滚动布局；左侧作品属性导航、中间白色内容卡片、右侧 AI 面板分别拥有自己的内部滚动条，避免页面外层出现额外滚动条。
- 作品属性包含人称和频道。人称选项为“第一人称 / 第三人称”，频道选项为“男频 / 女频”；新增作品表单、作品详情、创建预览和继续写作页基础设置需要同步展示。
- 作品库与继续写作页的同一作品信息必须保持一致。继续写作页只根据来源作品 ID 读取后端作品详情；没有真实作品、接口返回空数组或详情读取失败时显示空状态，不再硬编码具体作品名、章节、字数或世界观文件。
- 继续写作页作品信息 tab 中，角色分组加号打开角色管理页，只保留“添加角色”操作，不显示导入角色、生成角色、时间类按钮；背景分组不显示加号；势力、地点、物品分组加号打开各自新增页面；核心文件分组包含故事基石、卷纲规划、当前状态、伏笔池四个可查看入口。
- 760px 以下必须强制全局壳回到单列布局，避免后置主题覆盖层重新声明桌面侧栏宽度后压缩主内容。
- 标题层级保持克制：顶部“创作工作台”约 19px，页面标题约 17px，页面内区块标题不超过 16px，普通卡片标题和数据文本不超过 15px。

## 后续维护提醒

- 修改目录结构时，同步更新本文档的“当前目录结构”。
- 新增页面或删除页面时，同步更新“页面能力”。
- 新增配置文件、API 文件、状态 store 时，同步更新“配置维护约定”或“接口预留说明”。
- 调整设计语言、字体、按钮、响应式策略时，同步更新“样式约定”。
