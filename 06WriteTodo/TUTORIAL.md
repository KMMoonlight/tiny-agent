# 06 · Write Todo：让 Agent 自己维护任务清单

到第五章为止，Agent 已经会调工具、有钩子、有权限、有一份像样的系统提示词。但把任务拉长到七八步，一个老问题就暴露了：**"计划"只存在于模型的隐式推理里**。

模型在第一步想好了"先搜 A、再搜 B、然后统计、最后保存"，但这个计划哪儿都没记。随着消息历史变长——工具结果、审批交互、中间答案不断挤进来——模型对最初计划的"记忆"被稀释，于是出现典型的长任务症状：

- 漏步骤：统计完字符数就直接总结了，忘了保存
- 重复步骤：又搜了一遍已经搜过的内容
- 顺序漂移：计划里"先算差值再保存"，执行时颠倒了

人类的解法是在纸上列个清单，做完一项划掉一项。本章给 Agent 同样的能力：一个 `write_todo` 工具，让**模型自己**把计划写下来、边做边更新。

## 关键认识：todo 清单是写给模型自己看的

`write_todo` 不是给人类看的进度条。它的全部价值在于一个机制——**工具调用和 Observation 都会进入消息历史**：

```
assistant → 调用 write_todo([...七条 todo...])
tool      → "Todo list updated:\n[>] 搜索 ReAct\n[ ] 搜索 tool calling\n[ ] ..."
assistant → 调用 knowledge_search(...)
tool      → "..."
assistant → 调用 write_todo([...第一条 completed，第二条 in_progress...])
tool      → "Todo list updated:\n[x] 搜索 ReAct\n[>] 搜索 tool calling\n[ ] ..."
```

每一次 `write_todo`，计划就以文本形式固化进上下文；之后每一次 LLM 请求，模型都会**重新读到**这份清单的最新状态。第二章的 `ToolContext` 是**程序的记忆**（notes 存在 Map 里），todo 清单是**模型的记忆**——它碰巧也存在 `ToolContext` 里，但真正让它生效的是消息历史里的那些文本回声。

这也解释了为什么本章**不需要 `read_todo` 工具**：清单刚刚由模型自己写过、Observation 也回显过，它就在上下文里，再读一遍是浪费。

## 本章的演示任务

`main.ts` 给了一个七步任务，并在任务里明确要求先规划：

```
1. 使用 knowledge_search 搜索 ReAct 的相关知识
2. 使用 knowledge_search 搜索 tool calling 的相关知识
3. 使用 text_stats 统计两次搜索结果的字符数
4. 使用 calculator 计算两个字符数的差值
5. 把差值通过 save_note 保存，key 为 todo_demo    ← 仍触发人工审批
6. 使用 list_notes 确认笔记已保存
7. 按 Output Format 输出最终总结

这是一个多步骤任务：先用 write_todo 规划全部步骤，
每完成一步就更新任务清单，再开始下一步。
```

运行时从日志里能看到模型先花一步写清单，然后每完成一两个步骤就回来更新一次：

```
[>] 搜索 ReAct 的相关知识
[ ] 搜索 tool calling 的相关知识
[ ] 统计两次搜索结果的字符数
[ ] 计算字符数差值
[ ] 保存差值到笔记
[ ] 确认笔记已保存
[ ] 输出最终总结
```

## 代码结构

```
06WriteTodo/
├── types.ts             # 类型定义（与上一章相同）
├── llm.ts               # LLM 客户端（与上一章相同）
├── tool.ts              # 改动：ToolContext 增加 todos 字段 + TodoItem 类型
├── hooks.ts             # AgentHooks + HookManager（与上一章相同）
├── logger-hook.ts       # 日志钩子（与上一章相同）
├── metrics-hook.ts      # 指标钩子（与上一章相同）
├── permission.ts        # 改动：write_todo 分级为 safe
├── approval-hook.ts     # 审批钩子（与上一章相同）
├── prompt.ts            # 分节组装系统提示词（与上一章相同）
├── calculator.ts        # 工具（均与上一章相同）
├── text-stats.ts
├── current-time.ts
├── knowledge-search.ts
├── notes.ts
├── todo.ts              # 新增：write_todo 工具
├── agent.ts             # 改动一行：context 初始化增加 todos: []
└── main.ts              # 入口：注册工具 + Task Tracking 提示词节 + 演示任务
```

注意"新增一个能力"在本章的完整成本：**注册一个工具 + 加一节提示词 + 一行 context 初始化**。循环、钩子、权限全部原样工作——这是前五章分层设计的回报。

## write_todo 的设计决策（todo.ts）

### 全量覆写，而不是增量操作

工具参数不是"添加一条""更新第 3 条"这样的增量操作，而是**每次重写完整清单**：

```ts
parameters: {
  todos: {
    type: "array",
    description: "The complete todo list. It replaces the previous list entirely.",
    items: { content, status },
  },
}
```

三个理由：

- **参数简单**。增量操作需要 id 或下标定位，模型很容易指错；全量覆写只有一个参数
- **Observation 自带全貌**。执行结果把渲染后的完整清单回显给模型，上下文里永远有最新状态
- **重写即复习**。模型每次重新陈述整个计划，本身就是对计划的一次"再注意"——这正是我们想要的

### 状态机 + 校验：错误即反馈

三条状态 `pending` / `in_progress` / `completed`，外加一条约束：**最多一个 `in_progress`**。校验不通过直接抛错：

```ts
if (inProgress.length > 1) {
  throw new Error(
    `expected at most one in_progress task, got ${inProgress.length}`,
  );
}
```

抛出的错误会被 `ToolRegistry` 包装成失败的 Observation 反馈给模型——从第一章延续到现在的"错误即反馈"模式：模型读到 `todos[2].status must be one of: pending, in_progress, completed` 后会自己修正参数重试，不需要任何额外代码。

### 权限分级：safe

`permission.ts` 里把 `write_todo` 定为 `safe`：它只改写内存中的一块状态，没有任何外部副作用。如果按 `defaultLevel: "sensitive"` 走，模型每更新一次清单就要停下来问一次人——规划节奏会被审批彻底打断。**审批的成本本身也是设计权限分级时要算的账。**

## 提示词：新增 Task Tracking 一节（main.ts）

第五章搭好的分节结构，让"告诉模型什么时候该写 todo"变成加一节配置：

```ts
{
  heading: "Task Tracking",
  body: `
For any task with 3 or more steps:

1. Before starting, call write_todo to plan all the steps.
2. Keep exactly one step in_progress at a time.
3. After finishing each step, call write_todo again:
   mark the finished step completed and move the next
   step to in_progress. Always rewrite the full list.
4. The todo list is your working memory.
   Your final answer must reflect what it records.`,
},
```

注意第 1 条给了**触发条件**（3 步以上才用）。没有这个条件，模型会对"现在几点"这种单步问题也先写个 todo 清单——工具是手段不是仪式，什么时候不用和什么时候用一样要写清楚。

## 运行

```bash
npx tsx 06WriteTodo/main.ts
```

`save_note` 仍会触发一次人工审批（`y` / `n` / `a`），其余步骤自动执行。值得做的对照实验：

- **删掉 Task Tracking 一节再跑**：观察模型还会不会主动写 todo（多数模型不会，说明这个行为是提示词"要求"出来的，不是工具存在就自动发生）
- **把任务砍到两步再跑**：有了"3 步以上"的触发条件，模型应该跳过 write_todo 直接执行

## 它的边界

和第五章的提示词规则一样，todo 机制也是**软约束**：模型可能忘了更新清单，可能把没做的事标成 completed，可能跳过规划直接开干。`write_todo` 把计划外化到了上下文里，但"遵守计划"仍然依赖模型配合。如果某天你需要"所有 todo 完成前不允许输出最终答案"这种硬保证，老规矩——去钩子层做（练习 3）。

## 动手练习

1. **提醒机制**：模型偶尔会埋头执行、忘记更新 todo。扩展 `AgentHooks`：让 `onStepStart` 可以返回一个字符串，`Agent` 把它作为一条 user 消息注入对话（例如"你已经 3 步没更新任务清单了"）。想一想：提醒是**外部推动**，todo 是**模型自驱**——真实系统里两者怎么配合才不会互相干扰（比如提醒太频繁反而打乱模型节奏）？

2. **加一条 `cancelled` 状态**：当某一步被审批拒绝、继续执行没意义时，模型应该能把它标记为 `cancelled` 而不是谎报 `completed`。改 `TodoStatus` 和校验逻辑，并在 Task Tracking 一节里说明用法。`save_note` 被拒后，观察模型的清单和最终总结有什么变化。

3. **硬保证"全部完成才能收尾"**：在钩子层实现——当模型试图给出最终答案（不再调工具）而 `context.todos` 里还有未完成的项时，拦截这次收尾，把"还有 N 项未完成"作为一条消息反馈给模型让它继续。这需要扩展哪个钩子点？（提示：现在 `onRunEnd` 在答案返回**之后**触发，你需要一个答案返回**之前**的拦截点——想想第四章的 `ToolCallDecision` 是怎么设计的。）
