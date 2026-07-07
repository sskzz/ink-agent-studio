# Ink Agent Studio 前端项目说明

本文档用于记录前端项目的当前设计、目录结构、页面能力和后续维护约定。后续每次调整页面、目录、配置、接口预留点或核心交互时，都需要同步更新本文档，避免项目越迭代越难接手。

## 项目定位

Ink Agent Studio 是一个本地优先的 Agent 创作系统前端。当前阶段只实现前端页面、模拟数据和接口调用预留位置，不直接落盘、不真正调用模型、不保存真实 API Key。

第一版重点目标：

- 搭建作品库、作品详情、继续写作、写作风格、模型配置等核心页面。
- 以本地优先为前提，后续可接入 Java 后端、本地文件系统、模型网关和 Agent 写作流水线。
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
      data/                    写作风格 mock 数据和类型
      pages/                   写作风格页面
  shared/                      跨功能复用能力
    api/                       前端 API 适配层和 mock 请求
    components/ui/             通用 UI 组件
    stores/                    Zustand 状态
    styles/global.css          全局样式
    types/domain.ts            跨功能领域类型
  main.tsx                     前端挂载入口
```

## 页面能力

- 总览：展示当前创作系统入口和状态概览。
- 作品库：展示作品列表、新建作品入口、作品详情。
- 作品详情：展示作品信息、作品属性、当前章节、已写字数、已写章节、角色列表、核心文件和世界观。角色、核心文件、世界观支持 Markdown 弹窗渲染。
- 继续写作：只能从作品详情的“继续写作”按钮进入。当前已改为沉浸式小说编辑器布局，隐藏项目级侧边栏和顶部状态栏；页面包含顶部作品状态栏、左侧“作品信息 / 正文 / 草稿”导航、中间属性/章节编辑面板、右侧“灵感卡片 / AI对话”面板。左侧作品属性已补齐主题、标签、简介、总纲、设置、角色、背景、势力、地点、物品、细纲、章节、草稿箱等入口。进入编辑器时会记录来源作品 ID，左上角“退出”会返回对应作品详情页。
- 写作风格：包含风格列表、新增风格、风格详情；AI 分析当前为模拟结果。
- 模型配置：包含模型类型入口、模型列表、写作模型选择、审稿模型选择、模型详情表单。
- Agent 控制台、世界状态、运行记录、设置：当前为页面占位，后续按功能逐步补齐。

## 配置维护约定

- 新增侧边栏功能入口：优先修改 `src/config/navigation.ts`。
- 新增模型服务商、模型用途：优先修改 `src/config/modelOptions.ts`。
- 新增通用 UI：放入 `src/shared/components/ui`。
- 新增业务页面：放入对应 `src/features/<feature>/pages`。
- 新增跨页面类型：放入 `src/shared/types/domain.ts`；仅单功能使用的类型优先放在对应 feature 内部。
- 新增接口适配：放入 `src/shared/api`，页面不要直接写 `fetch`。

## 接口预留说明

当前模型配置页面通过 `src/shared/api/modelConfigApi.ts` 使用浏览器本地 mock 数据。后续接入后端时建议保留页面和 store 不变，只替换 API 层实现。

建议后端接口方向：

- `GET /api/v1/model-configs`：读取模型配置列表。
- `POST /api/v1/model-configs`：保存模型配置。
- `DELETE /api/v1/model-configs/:id`：删除模型配置。
- `POST /api/v1/model-configs/:id/default`：设置默认模型。
- `POST /api/v1/model-configs/test`：测试模型连通性。
- `GET /api/v1/books`：读取本地作品列表。
- `GET /api/v1/books/:id`：读取作品详情和 Markdown 文件索引。
- `POST /api/v1/writing-styles/analyze`：分析模板作品并生成写作风格。

## 样式约定

- 全局样式集中在 `src/shared/styles/global.css`。
- 当前视觉方向为参考 AI-Novel-Writing-Assistant 与在线小说编辑器的浅色编辑台样式：页面背景保持浅灰蓝，核心内容使用白底区域、细边框、低阴影和紧凑信息密度，避免厚重玻璃拟态和大面积高饱和背景。
- 全局字体以 `HarmonyOS Sans SC`、`MiSans`、`Alibaba PuHuiTi 3.0` 为优先字体，并保留 `PingFang SC`、`Microsoft YaHei UI` 等中文字体回退。
- 全局按钮使用深色主按钮和浅灰辅助按钮，避免纯白无边界按钮。
- 页面切换、卡片悬停和功能入口保留轻量动效，动效以快速、克制、不影响阅读为原则。
- 页面要保证浏览器缩放、窄屏和长文本情况下不出现横向溢出。
- 继续写作页右侧 AI 面板可通过边缘小箭头按钮收起或展开，展开态按钮位于主内容和右侧面板之间，收起态按钮固定紧贴浏览器右侧边缘。
- 继续写作页内滚动条默认隐藏，在页面滚动或鼠标移动到编辑器区域时短暂显示；中间编辑区只保留白色卡片内部滚动，外层容器不再显示第二条滚动条。
- 760px 以下必须强制全局壳回到单列布局，避免后置主题覆盖层重新声明桌面侧栏宽度后压缩主内容。
- 标题层级保持克制：顶部“创作工作台”约 19px，页面标题约 17px，页面内区块标题不超过 16px，普通卡片标题和数据文本不超过 15px。

## 后续维护提醒

- 修改目录结构时，同步更新本文档的“当前目录结构”。
- 新增页面或删除页面时，同步更新“页面能力”。
- 新增配置文件、API 文件、状态 store 时，同步更新“配置维护约定”或“接口预留说明”。
- 调整设计语言、字体、按钮、响应式策略时，同步更新“样式约定”。
