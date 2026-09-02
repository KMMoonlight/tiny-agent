# 09 · Sub Agents：把子任务外包给隔离的上下文

上一章的上下文压缩解决的是"历史太长怎么办"——把中段换成摘要，硬挤进窗口。但压缩有个前提没被动摇：**所有中间过程都得先进入主上下文，再被有损地丢掉**。搜索原文、试错、中间计算，全都进来过一遍，付费、占窗口、稀释注意力，最后靠摘要抢救。

本章换一个思路：**有些中间过程根本就不该进来**。把自包含的子任务派给一个子代理（subagent）——它在自己的隔离上下文里跑完整个 ReAct 循环，主 Agent 只看到它的一句最终答案。

```
主 Agent 的消息历史:

  user      研究四个主题……
  assistant 调用 spawn_subagent(researcher, "研究 ReAct……")
  tool      { answer: "要点：……，字符数：183" }   ← 子代理跑了 4 步，
  assistant 调用 spawn_subagent(researcher, "研究 tool calling……")   主上下文只有这一行
  tool      { answer: "要点：……，字符数：207" }
  ……
```

子代理内部可能做了搜索、统计、好几次推理——对主 Agent 来说，这 N 条消息被折叠成了 1 条 Observation。**压缩是"先进来再丢"，委派是"根本不进来"**，后者省得更彻底，还无损（答案里的数据是子代理亲口写的，不是摘要转述的）。

## 关键认识：子代理只是一个工具

`subagent.ts` 没有动 `agent.ts` 一行代码。`spawn_subagent` 是一个普通工具，走普通的注册、调用、Observation 通道——循环、钩子、权限、压缩全部零改动。这和第七章"加载即注入"是同一个结构：**Agent 的扩展点不在核心循环里，而在工具接口上**。

工具的 execute 里做的事情直截了当：

```ts
const subagent = new Agent(llm, tools, spec.systemPrompt, hooks);
const answer = await subagent.run(task);

return { agent: spec.name, answer };  // 只返回最终答案
```

`Agent` 类在构造时创建自己的 `ToolContext`（第五章以来一直如此），所以每次调用 `new Agent(...)` 天然得到一套全新的隔离状态：消息历史是新的，notes 是新的，todos 是新的。子代理之间、子代理与父代理之间互不可见。**隔离不需要专门的机制，它就是"再 new 一个实例"**。

## 上下文隔离的两个推论

**任务描述必须自包含。** 子代理看不到父的对话历史——用户说过什么、父代理已经查到什么，它一概不知。它拿到的全部输入就是 `task` 参数。所以工具描述和系统提示词里反复强调："the task you write is the ONLY input it gets"。父代理把任务写少了，子代理只能靠猜。

**子代理的最终答案就是它的全部产出。** 父代理能用的只有那一句话——子代理搜到的原文、中间数字，没写进答案就等于丢了。所以 researcher 的系统提示词里专门有一条：

```
Keep every exact number from tool results in your final answer —
the caller sees ONLY your final answer, not your intermediate
steps. Anything you leave out is lost.
```

注意这和第八章压缩摘要的四要素是同构的：**凡是"上下文要被折叠"的地方，提示词就是信息保真度的全部杠杆**。压缩折叠的是过去，子代理折叠的是下级。

## 工具子集即权限边界

每个子代理类型用 `SubagentSpec` 声明自己是谁、能用什么：

```ts
{
  name: "researcher",
  description: "Researches one topic with the local knowledge base...",
  tools: [knowledgeSearchTool, textStatsTool],   // 只有这两个
  systemPrompt: "...",
}
```

researcher 拿不到 `save_note`、`delete_note`，也拿不到 `spawn_subagent` 自己——**子代理不能再派生子代理**，嵌套深度被工具子集天然锁死在 1。这比在提示词里写"你不许做什么"可靠得多：工具不在注册表里，模型想调也调不到（第四章的白名单思维，从"审批策略"前移到了"能力声明"）。

`description` 字段的读者是父 Agent——它写进 `spawn_subagent` 的工具描述里，父模型据此决定派给谁。这是继工具的 description（02 章）、skill 的 description（07 章）之后，第三个"写给模型看的选择依据"。

## 从日志里看嵌套

父子两个 Agent 同时打日志会混在一起，所以 `logger-hook.ts` 从常量改成了工厂 `createLoggerHook(prefix)`：子代理的每行日志带 `[researcher]` 前缀。运行时能清楚看到主 Agent 在 step 里发起 spawn，然后子代理的 step 序列完整跑完，主 Agent 才收到 Observation 继续走。

父 Agent 的 metrics 钩子只统计到 `spawn_subagent` 调用——子代理的工具调用发生在另一个 HookManager 里，不进父的账。这是隔离的必然结果：**观测性和上下文一样，是按实例隔离的**。

## 代码结构

```
09SubAgents/
├── subagent.ts          # 新增：SubagentSpec + createSpawnSubagentTool
├── logger-hook.ts       # 改动：常量改为 createLoggerHook(prefix) 工厂
├── permission.ts        # 改动：spawn_subagent 标记为 safe
├── main.ts              # 改动：定义 researcher 子代理 + 新演示任务
├── agent.ts / hooks.ts / compact.ts / ...（其余均与上一章相同）
└── skills/
```

## 本章的演示任务

`main.ts` 刻意沿用第八章的研究任务，只把执行方式从"自己搜"改成"派子代理搜"：

```
1. 对每个主题，调用 spawn_subagent 派一个 researcher 子代理去研究，
   要求它返回该主题的一句话核心要点和搜索结果的精确字符数
2. 四个子代理全部返回后，你自己总结：
   每个主题的核心要点，并指出哪个主题字符数最多、具体是多少
```

同一个任务，两种跑法，正好构成对照实验：

- **08 章**：主 Agent 自己搜四个主题，十几份原始搜索结果和统计中间过程全部进入主上下文，撑过阈值反复触发压缩，最终答案里的字符数靠摘要回忆
- **09 章**：进入主上下文的只有 4 条 Observation（每个子代理一条最终答案），原始搜索结果从头到尾没进来过；最终答案里的字符数来自子代理的原话，不是摘要转述

注意演示配置里 `maxTokens: 400` 是故意调小的玩具阈值，子代理答案写得啰嗦时父代理照样会触发压缩——但被折叠的体量完全不是一个量级，而且压缩的输入里已经没有原始搜索结果了。

## 运行

```bash
npx tsx 09SubAgents/main.ts
```

观察日志里 `[researcher]` 前缀的子代理循环，和主 Agent 收到的精简 Observation。对照第八章跑一遍同一任务，数一下各自进入主上下文的消息条数。

实测中还有一个意外的教学点：本章的跑一次压缩把摘要写错了（声称"还没有派出任何子代理"），是 tail 里保留的子代理答案让模型恢复了正确结论——正好是第八章"错误会固化"风险的现场演示，也说明了"最近消息原样保留"这道防线的价值。

值得做的对照实验：

- **把子代理的系统提示词里"保留精确数字"那条删掉再跑**：观察子代理答案丢掉字符数后，主 Agent 怎么错——体会"子代理的答案就是信息瓶颈"
- **把 `task` 写得含糊一些**（比如只说"研究一下这个主题"）：观察子代理因为不知道要什么格式而各说各话——体会任务描述自包含的重要性

## 它的边界

- **子代理不能反问**。它没有人交互的通道（approval hook 没给它，readline 也不在它手里），任务描述不全它只能猜。真实系统里有的做法是允许子代理返回"需要澄清"的状态让父代理接力——本章没有这层
- **信息流是单向的**。父给子只有一段 task 文本，子给父只有一段 answer 文本。共享 notes、todos 这类 ToolContext 在本章被刻意隔离；要共享就得显式传引用，而那会重新打开耦合
- **成本没有消失，只是转移**。四个子代理各自重建上下文（system prompt + 任务 + 工具定义），总 token 消耗比一个人做更高。子代理省的是主上下文的"地段"和注意力，不是钱
- **本章是串行的**。父 Agent 的工具执行循环是顺序的，连续 spawn 四个子代理就是一个跑完再跑下一个。并行化是真实系统里子代理的主要卖点之一，见练习

## 动手练习

1. **并行子代理**：把 `spawn_subagent` 的参数改成 `tasks: string[]`，在 execute 里用 `Promise.all` 并行跑多个子代理实例（每个仍然是独立的 `new Agent`）。对比串行版的总耗时，想想 metrics 钩子该怎么改才能分清"墙钟时间"和"累计 token 时间"。

2. **失败兜底**：子代理超步数或报错时，目前错误直接包装成失败的 Observation 交给父模型。给 `SubagentSpec` 加一个 `retries` 字段实现自动重试，再想想：重试应该带着原来的 task 重跑，还是把失败原因也告诉下一个实例？

3. **受控的嵌套**：让某个子代理类型的工具子集里包含 `spawn_subagent` 本身，实现两级委派。必须加一个深度限制（比如在 spec 里声明 `depth`，超过就拒绝），否则模型可能无限套娃——观察没有限制时它会不会真的套下去。
