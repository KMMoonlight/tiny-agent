# tiny-agent

从零手写 Agent 的系列教程。每一章都是一个独立可运行的小项目，不依赖任何 Agent 框架，用最少的代码讲清楚一个核心概念。

## 章节

### [01 · ReAct](./01ReAct/TUTORIAL.md)

手写一个最小可运行的 ReAct（Reasoning + Acting）Agent，约 200 行 TypeScript。

- ReAct 的核心原理：LLM 在"推理 → 调用工具 → 观察结果"的循环中逐步求解问题
- LLM 客户端：OpenAI 兼容 API 的调用方式，`tool_choice`、`tool_calls`、`tool_call_id` 等机制
- 工具系统：工具 = 给模型看的 JSON Schema 声明 + 给程序跑的本地实现
- Agent 核心循环：消息数组如何作为记忆一步步增长，循环何时结束
- 动手练习：不改 Agent 代码，添加一个新工具

```bash
npx tsx 01ReAct/main.ts
```

## 准备工作

```bash
npm install
```

在项目根目录创建 `.env` 文件，填入任意 OpenAI 兼容 API 的配置：

```bash
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-xxxx
LLM_MODEL=gpt-4o-mini
```
