# 08 · Context Compact：给消息历史做压缩

前七章搭建的 Agent 有一个共同的隐含假设：**消息历史可以无限增长**。每一步循环都往里追加 assistant 消息和工具结果，从不清除。短任务没问题，但任务拉长之后三重代价接踵而来：

- **硬限制**：上下文窗口有上限，历史撞顶后请求直接报错，Agent 当场死亡
- **成本**：每次 LLM 请求都要为全部历史付费，第 20 步的请求比第 1 步贵几十倍
- **注意力**：第六章说过"提示词是最贵的地段"——历史越长，早期的关键信息（比如用户的原始要求）被稀释得越厉害

本章给 Agent 加上下文压缩：**当历史超过预算时，把较早的消息总结成一段摘要，只保留 system prompt + 摘要 + 最近几条消息**。

## 关键认识：压缩是"用一段摘要换掉一段历史"

压缩后的消息数组长这样：

```
[0] system    系统提示词                    ← 永远不动
[1] user      [Context compacted] 摘要      ← 替代原来的第 1~N 条
[2..]         最近 keepRecent 条消息        ← 原样保留
```

三个部分各有存在的理由：

- **system prompt 不动**：它是常量，不占"增长"的部分，重写它反而引入漂移
- **摘要替代中段**：早期的搜索、计算结果已经完成历史使命，模型需要的不是逐字原文，而是"做过什么、关键数据是什么"
- **最近几条原样保留**：正在进行的工具调用链（assistant 发起调用 → tool 返回结果）必须完整，模型紧接着就要基于它们推理

判断何时压缩用的是一个粗略的 token 估算（`compact.ts`）：

```ts
// 一个中文字符约 1 token，其余字符约 4 个 1 token
if (estimateTokens(messages.slice(1)) > this.compaction.maxTokens) { ... }
```

注意 `slice(1)`：**估算和压缩都只针对会增长的部分**，system prompt 是固定开销，不计入预算。否则要么阈值很难定（得先减去提示词大小），要么提示词本身就撑爆阈值、每一步都触发压缩。

## 摘要由谁来写：LLM 自己

压缩不是程序能机械完成的——"哪些数据重要"需要理解任务。所以 `compact.ts` 里的 `summarize` 直接把中段历史序列化成文本，再发一次普通的 LLM 请求（不带工具）：

```
You are compacting the conversation history of an AI agent
that is in the middle of a task. Write a concise summary that
lets the agent continue WITHOUT the original messages:

1. The user's original task, including all explicit requirements.
2. Steps already completed, with key results kept EXACT
   (numbers, names, values from tool results).
3. The current todo list state, if there is one.
4. What remains to be done.
```

这四条的措辞是直接决定压缩质量的杠杆：第 1 条防"忘了要干什么"，第 2 条的 EXACT 防数字在摘要里走样，第 3 条把第六章的 todo 状态接力下去，第 4 条防"以为已经做完了"。

摘要写完后，作为一条 user 消息插回历史，并附上 `[Context compacted]` 前缀和"基于摘要与后续消息继续任务"的说明——模型需要知道这段文本的来历，否则会把它当成用户的新指令。

## 一个必须处理的边界：tool 消息不能孤儿化

OpenAI 兼容 API 有个硬约束：**`tool` 消息必须紧跟在发起它的 `assistant`（带 `tool_calls`）消息之后**。如果按"保留最近 N 条"机械地切，切口可能恰好落在工具调用链中间——tail 以一条 tool 消息开头，它引用的 `tool_call_id` 在被丢掉的历史里，API 直接报错。

`compactMessages` 的处理方式是切口向前回溯：

```ts
let tailStart = Math.max(1, messages.length - config.keepRecent);

while (tailStart > 1 && messages[tailStart]?.role === "tool") {
  tailStart--;
}
```

宁可多保留几条，也不能拆散工具调用链。这个例子很典型：**上下文工程里大量工作是维护消息序列的结构性约束**，不是文本本身。

## 新钩子点：onCompact

压缩是 Agent 运行中的大事——历史被换掉了。第三章搭的钩子系统在这里收获回报：新增一个 `onCompact` 钩子点（`hooks.ts`），`Agent` 在压缩完成后触发，日志钩子打印压缩前后的估算 token 数和摘要内容：

```
Context compacted: ~720 -> ~310 tokens (est.)
Summary: ...
```

不改钩子系统的话，这个信息就得硬编码进 `agent.ts`——又回到第三章之前的形态了。**每次想往核心循环里加 `console.log`，先想想是不是缺一个钩子点。**

## 代码结构

```
08ContextCompact/
├── compact.ts           # 新增：token 估算 + 摘要压缩
├── agent.ts             # 改动：构造函数加 compaction 配置，循环里触发压缩
├── hooks.ts             # 改动：新增 onCompact 钩子点
├── logger-hook.ts       # 改动：打印压缩事件
├── main.ts              # 改动：传入压缩配置 + 新演示任务
├── types.ts / llm.ts / tool.ts / skill.ts / load-skill.ts
├── permission.ts / approval-hook.ts / metrics-hook.ts / prompt.ts
├── calculator.ts / text-stats.ts / current-time.ts
├── knowledge-search.ts / notes.ts / todo.ts
└── skills/              # （以上均与上一章相同）
```

## 本章的演示任务

`main.ts` 的任务要求研究四个主题并逐条统计字符数——足够多步数把历史推过阈值（演示配置 `maxTokens: 400`，故意调小让压缩必触发）：

```
1. 用 knowledge_search 分别搜索这四个主题
2. 每搜完一个主题，用 text_stats 统计结果内容的字符数
3. 最后总结：每个主题的核心要点，
   并指出哪个主题的搜索结果字符数最多、具体是多少
```

最后一问是精心设计的**压缩质量检验**：等模型回答时，早期的搜索结果和字符数已经被压缩掉了，它只能从摘要里回忆。"哪个主题字符数最多、具体多少"这种精确问题，摘要漏一个数字就答不出来。

## 运行

```bash
npx tsx 08ContextCompact/main.ts
```

从日志里能看到：中途打印 `Context compacted: ~X -> ~Y tokens`，之后模型基于"摘要 + 最近消息"继续工作，最终答案里的字符数数据来自摘要而非原始工具结果。值得做的对照实验：

- **把 `maxTokens` 调到 100000（等于关闭压缩）再跑**：对比两次最终答案，检验摘要是否保住了关键数据
- **把摘要提示词里的第 2 条删掉再跑**：观察摘要丢失精确数字后，最终答案怎么错——体会"压缩提示词是压缩质量的全部杠杆"

## 它的边界

- **压缩是有损的**。摘要写得再好也是摘要，原文里的细节（某次工具报错的完整堆栈、某段文字的精确措辞）可能永远丢失。真实系统常把原始历史落盘，配合一个"搜索历史"的工具让模型按需打捞——那是给摘要兜底的机制
- **错误会固化**。如果摘要漏了或记错了数据，之后每一步都建立在错误摘要上，且没有任何机制能发现。第七章的 skill 可以部分缓解（让"压缩要点"也成为可维护的指令），但本质风险不变
- **重复压缩会逐次衰减**。长任务可能触发多次压缩，第二次压缩的输入里包含第一次的摘要——摘要的摘要，信息逐次损耗。缓解方向是单调维护一份滚动摘要而不是反复压缩整段历史

## 动手练习

1. **压缩前落盘**：在 `onCompact` 钩子里把被丢弃的原始消息写入 `history-<时间戳>.json`，再加一个 `search_history(keyword)` 工具去读它。观察模型在发现摘要信息不足时会不会主动去捞原文。

2. **滚动摘要**：把"压缩中段"改成"把中段合并进上一次的摘要"——摘要消息如果有且只有一条，第二次压缩时将它一并交给 `summarize`。对比滚动摘要与本章实现多次压缩后的信息保留差异。

3. **压缩不压缩 tool 结果之外的东西**：本章按消息条数保留 tail。另一个策略是按"消息类型"压缩：只摘要 tool 结果（通常最占空间），assistant 的推理文本原样保留。改造 `serialize` / 压缩边界实现它，想想这个策略在什么场景下更好、什么场景下更糟。
