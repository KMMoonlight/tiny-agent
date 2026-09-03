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

### [04 · Permission](./04Permission/TUTORIAL.md)

在 Hooks 之上加一层权限系统：三级风险模型 + 人工审批，让模型想做什么必须经过人允许做什么这道闸门。

- 三级风险模型：safe 自动放行、sensitive 暂停循环请求人工审批、dangerous 一律拒绝
- 审批钩子：readline 终端交互，y 批准一次 / n 拒绝 / a 本次运行内总是允许
- 白名单思维：未被策略覆盖的未知工具默认按 sensitive 处理
- Agent 零改动：审批只是又一个 onToolCall 钩子，决定仍走 ToolCallDecision 通道反馈给模型

```bash
npx tsx 04Permission/main.ts
```

### [05 · System Prompt](./05SystemPrompt/TUTORIAL.md)

把硬编码在 Agent 里的系统提示词变成一等工程产物：依赖注入、分节组装、运行期上下文注入。

- 提示词即依赖：system prompt 移出 `agent.ts`，变为构造函数参数，改提示词不再碰核心循环
- 分节组装：Role / Tool Rules / Runtime Context / Output Format，提示词成为自文档化的配置
- 上下文注入：当前时间、可用工具清单（与 ToolRegistry 同源）织入提示词，省掉一次工具往返
- 提示词不是安全边界：提示词负责引导，03/04 章的钩子与权限负责强制

```bash
npx tsx 05SystemPrompt/main.ts
```

### [06 · Write Todo](./06WriteTodo/TUTORIAL.md)

给 Agent 一个 `write_todo` 工具，让模型自己把计划写下来、边做边更新，把规划从隐式推理外化到上下文里。

- 问题场景：多步任务中计划只存在于模型的隐式推理里，消息历史变长后漏步骤、重复步骤、顺序漂移
- todo 清单是模型的记忆：每次调用和 Observation 都进入消息历史，之后每一步 LLM 请求都会重读最新计划
- 全量覆写设计：每次重写完整清单，Observation 自带全貌，重写即复习
- 状态机 + 校验：pending / in_progress / completed，最多一个 in_progress，错误即反馈

```bash
npx tsx 06WriteTodo/main.ts
```

### [07 · Skills](./07Skills/TUTORIAL.md)

给 Agent 一个 `load_skill` 工具，把专业能力打包成独立的 SKILL.md 文件，元数据常驻提示词，完整指令按需加载（渐进式披露）。

- 问题场景：所有能力指令都堆在系统提示词里，提示词膨胀、注意力稀释、改格式要改代码
- SKILL.md = frontmatter 元数据（name/description，常驻提示词）+ 正文规范（存在文件里，按需加载）
- SkillRegistry：启动时扫描技能目录、解析 frontmatter；`list()` 给提示词、`get()` 给工具，两个粒度分离
- 加载即注入：skill 正文作为 Observation 进入消息历史，循环、钩子、权限零改动

```bash
npx tsx 07Skills/main.ts
```

### [08 · Context Compact](./08ContextCompact/TUTORIAL.md)

消息历史只增不减，撞上上下文窗口只是时间问题。本章给 Agent 加上下文压缩：历史超过预算时，用 LLM 把中段总结成摘要，只保留 system prompt + 摘要 + 最近几条消息。

- 压缩结构：system prompt 不动 + 摘要替代中段 + 最近 N 条原样保留（正在进行的工具调用链不能拆）
- 摘要由 LLM 自己写：原始任务、已完成步骤的精确数据、todo 状态、剩余工作，四要素缺一就会跑偏
- 边界处理：tail 不能以 tool 消息开头（tool_call 配对约束），切口向前回溯
- 新钩子点 onCompact：压缩事件走钩子通道，不进核心循环

```bash
npx tsx 08ContextCompact/main.ts
```

### [09 · Sub Agents](./09SubAgents/TUTORIAL.md)

把自包含的子任务派给子代理：它在自己的隔离上下文里跑完整个 ReAct 循环，主 Agent 只看到一句最终答案，中间过程根本不进主上下文。

- 子代理只是一个工具：`spawn_subagent` 走普通工具通道，循环、钩子、权限、压缩零改动
- 上下文隔离：每次调用 `new Agent(...)` 得到全新消息历史和 ToolContext，隔离即再 new 一个实例
- 信息瓶颈：任务描述必须自包含（子代理看不到父的对话），子代理没写进答案的数据等于丢失
- 工具子集即权限边界：`SubagentSpec` 声明可用工具，天然锁死嵌套深度，比提示词约束可靠

```bash
npx tsx 09SubAgents/main.ts
```

### [10 · Memory](./10Memory/TUTORIAL.md)

给 Agent 跨运行的长期记忆：一个持久化到文件的记忆库 + `save_memory` / `search_memory` 两个工具，这次运行学到的事，下次运行还能捞回来。

- 两类记忆的分工：消息历史 / notes / todos 是工作记忆（单次运行），memory.json 是长期记忆（跨进程），判断标准是"这条信息下次运行还有用吗"
- 写入纪律决定记忆质量：只写稳定事实，任务中间状态进 notes/todos，不进长期记忆
- 检索而非全量注入：记忆按需搜，与 skills 渐进式披露、上下文压缩同源，提示词是最贵的地段
- `save_memory` 定级 sensitive：写错的记忆污染未来每一次运行，写入必须经过人工审批

```bash
npx tsx 10Memory/main.ts
```

### [11 · Exception Handle and Retry](./11ExceptionRetry/TUTORIAL.md)

补齐 Agent 错误处理中缺失的一环：工具失败早已包成 Observation 喂回模型，但 LLM 请求一失败整个 run 直接崩。本章给 LLM 请求加上错误分类、结构化错误和指数退避重试。

- 三类错误的分类学：工具错误进消息历史（模型处理）、LLM 请求错误静默重试（基础设施处理）、终止性错误直接 throw
- `LLMError` 结构化错误：status + retryable 两个字段做决策，不再解析错误消息字符串
- `RetryingLLMClient` 装饰器：再包一层实现同一个 `LLMClient` 接口，Agent、压缩、子代理同时受益，一行业务代码不改
- 指数退避 + `onRetry` 回调：给故障方留恢复时间，每次重试都留日志

```bash
npx tsx 11ExceptionRetry/main.ts
```

### [12 · Background Tasks](./12BackgroundTasks/TUTORIAL.md)

把等待从循环里拿掉：`run_in_background` 启动任务后立即返回 task id，任务在后台并行执行，完成时结果作为通知自动注入消息历史。

- 三个工具 + 一个注入点：`run_in_background` / `check_task` / `list_tasks` 走普通工具通道，`agent.ts` 每步 drain 完成通知
- 通知优于轮询：完成事件在下一个 step 自然出现，模型不需要思考"什么时候该查"
- 隔离的 ToolContext：每个后台任务独立上下文，避免与前台并发写 notes/todos 的竞态
- 权限延伸：只有 safe 工具能进后台，后台没有审批的机会，代执行工具必须把内部工具的风险等级重新过一遍策略

```bash
npx tsx 12BackgroundTasks/main.ts
```

### [13 · Cron Tasks](./13CronTasks/TUTORIAL.md)

给 Agent 加上时间维度的触发源：模型用 `create_cron` 把一段 prompt 挂到时间表上，调度器到点把它作为一次全新的 run 跑起来，`agent.ts` 一行不用改。

- cron 在主循环之外：后台任务把结果塞回这条对话（改循环），cron 每次触发是一条新对话（循环不变）
- 五字段 cron 解析器：`*`、`*/n`、单值、区间、步长、逗号列表；逐分钟扫描求下次触发，创建即校验
- 调度器三层结构：tick → 到点入队 → 串行 drain，慢 run 时触发排队而不并发互踩
- 每次触发是全新的 run：prompt 必须自包含，和子代理同一个"信息瓶颈"

```bash
npx tsx 13CronTasks/main.ts
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
