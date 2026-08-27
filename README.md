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

### [02 · Tools](./02Tools/TUTORIAL.md)

在 ReAct 循环的基础上，把工具系统扩展成完整形态：六个工具协同完成一条有数据依赖的七步任务。

- ToolRegistry：统一管理工具的注册、schema 收集和执行，错误统一包装后反馈给模型
- ToolContext：工具间共享的运行时状态，`save_note` 写入、`list_notes` 读取
- 六个工具的完整实现：计算、文本统计、时区时间、本地知识库检索、笔记存取
- 多工具编排：一步内并行调用多个工具、跨步传递中间结果、更详细的 system prompt 规则

```bash
npx tsx 02Tools/main.ts
```

### [03 · Hooks](./03Hooks/TUTORIAL.md)

在 ReAct 循环的关键节点引入生命周期钩子，把日志、指标、安全拦截这类横切逻辑从 Agent 主流程中拆出来。

- 五个钩子点：onRunStart / onStepStart / onToolCall / onToolResult / onRunEnd，覆盖观测与拦截两类需求
- HookManager：统一管理多个钩子的注册与触发，onToolCall 支持短路拦截
- 三个示例钩子：日志（从 Agent 搬出的 console.log）、有状态的指标统计、save_note 安全策略拦截
- 拦截即反馈：被钩子阻止的调用包装成失败的 Observation，模型读到原因后自行调整

```bash
npx tsx 03Hooks/main.ts
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
