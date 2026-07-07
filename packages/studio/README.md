# Ink Agent Studio 前端

这是本地优先 Agent 创作系统的前端页面工程，当前阶段只实现页面、交互和接口预留，不实现真实后端。

## 当前完成范围

- 工作台布局：左侧导航、中央内容区、右侧运行状态面板。
- 响应式适配：桌面、平板、窄屏和浏览器缩放场景下尽量避免横向溢出。
- 模型配置：支持配置列表、编辑表单、新增、保存、删除、设为默认、连接测试占位。
- 接口预留：`src/api/modelConfigApi.ts` 当前使用 `localStorage` mock，后续替换为真实 `/api/v1/model-configs` 即可。

## 关键文件

- `src/app/App.tsx`：前端路由入口。
- `src/components/layout/AppShell.tsx`：整体工作台布局。
- `src/pages/ModelsPage.tsx`：第一版核心功能，模型配置页面。
- `src/api/modelConfigApi.ts`：模型配置接口预留层。
- `src/stores/modelConfigStore.ts`：模型配置前端状态层。
- `src/styles/global.css`：全局主题、布局和响应式样式。

## 后续接后端的位置

第一版为了先把页面跑通，模型配置会保存到浏览器 `localStorage`。接入后端时，优先替换以下函数：

```ts
listModelConfigs()
saveModelConfig()
deleteModelConfig()
setDefaultModelConfig()
testModelConnection()
```

真实后端建议负责：

- API Key 加密保存。
- 本地 workspace 配置文件读写。
- 模型连接测试。
- 模型用途与 Agent Pipeline 的绑定。
