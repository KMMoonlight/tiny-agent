# 07 · Skills：让 Agent 按需加载专业技能

到第六章为止，Agent 的所有知识都在系统提示词里：角色、工具规则、输出格式。这套机制有个明显的扩展瓶颈：**提示词是上下文里最贵的地段**，它占据每一次 LLM 请求的开头。

假设产品要给 Agent 加二十种专业能力：写周报、写会议纪要、做代码审查、生成 SQL、翻译法律文书……每种能力都需要几百字的指令。全部塞进系统提示词？提示词膨胀到上万 token，每次请求都为之付费，而且大量无关指令稀释模型的注意力，反而让所有任务的质量都下降。更糟的是，这些指令和代码耦合在一起，改一个格式就要改代码、重新部署。

本章引入 **Skill（技能）**：把专业能力打包成独立的 `SKILL.md` 文件，系统提示词里只放一行简介，模型判断任务匹配时才通过 `load_skill` 工具把完整指令加载进上下文。这个模式叫**渐进式披露（progressive disclosure）**：元数据常驻，正文按需加载。

## 关键认识：skill 不是工具，是"延迟加载的提示词"

先看一个 skill 长什么样（`skills/weekly-report/SKILL.md`）：

```markdown
---
name: weekly-report
description: Write a structured weekly report (周报) from scattered
  notes, search results or conversation material. Use whenever the
  user asks for a 周报, weekly summary or weekly update.
---

# Weekly Report Skill

When writing a weekly report, follow these rules:

## Structure
1. **本周进展** — ...
2. **数据与结果** — ...
...
```

结构上它分两段：

- **frontmatter**（`---` 之间的元数据）：`name` + `description`。这部分会被收集进系统提示词的 Skills 一节，**常驻上下文**
- **正文**：完整的操作规范。这部分存在文件里，模型平时根本看不见

系统提示词里模型只看到：

```
## Skills

Available skills:
- weekly-report: Write a structured weekly report (周报) ...
- meeting-notes: Turn raw discussion material into structured meeting notes (会议纪要) ...

If the user's task matches a skill's description, call
load_skill with its name BEFORE starting the task, then
follow the loaded instructions exactly.
```

当用户说"给我写一份本周的学习周报"，模型发现任务命中 `weekly-report` 的描述，先调 `load_skill`，完整规范作为 Observation 进入消息历史，之后每一步请求模型都能读到它。加载后的执行流程：

```
user      → "给我写一份学习周报"
assistant → 调用 load_skill({ name: "weekly-report" })
tool      → "Skill loaded. Follow these instructions: # Weekly Report Skill ..."
assistant → 调用 knowledge_search(...)   ← 按 skill 要求收集素材
...
assistant → 按 skill 规定的四段结构输出周报
```

所以 skill 的本质是**一次工具调用把一段提示词注入上下文**。它和第六章 todo 清单共享同一个机制底座：进入消息历史的文本，就是模型的记忆。

## 代码结构

```
07Skills/
├── types.ts             # 类型定义（与上一章相同）
├── llm.ts               # LLM 客户端（与上一章相同）
├── tool.ts              # 改动：ToolContext 增加 loadedSkills 字段
├── skill.ts             # 新增：SkillRegistry，扫描目录 + 解析 SKILL.md
├── load-skill.ts        # 新增：load_skill 工具
├── hooks.ts             # 钩子系统（与上一章相同）
├── logger-hook.ts       # 日志钩子（与上一章相同）
├── metrics-hook.ts      # 指标钩子（与上一章相同）
├── permission.ts        # 改动：load_skill 分级为 safe
├── approval-hook.ts     # 审批钩子（与上一章相同）
├── prompt.ts            # 分节组装系统提示词（与上一章相同）
├── calculator.ts        # 工具（均与上一章相同）
├── text-stats.ts
├── current-time.ts
├── knowledge-search.ts
├── notes.ts
├── todo.ts
├── agent.ts             # 改动一行：context 初始化增加 loadedSkills
├── main.ts              # 入口：加载技能目录 + Skills 提示词节 + 演示任务
└── skills/
    ├── weekly-report/
    │   └── SKILL.md     # 周报撰写规范
    └── meeting-notes/
        └── SKILL.md     # 会议纪要规范
```

新增能力的成本依然是老配方：**一个注册表 + 一个工具 + 一节提示词**。Agent 循环、钩子、权限零改动。

## SkillRegistry：启动时扫描（skill.ts）

`SkillRegistry.loadDir` 在启动时扫描 `skills/` 目录，每个子目录读取一个 `SKILL.md`，解析 frontmatter 和正文：

```ts
function parseSkillFile(content: string): Skill {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  // frontmatter 里的 name / description + 正文 body
}
```

注意这里**故意不用 YAML 库**：frontmatter 只需要 `key: value` 两行，手写十几行解析比引入依赖更符合"每章自包含"的原则。真实系统（如 Claude Code 的 Agent Skills）会在 frontmatter 里放更多字段（版本、依赖、允许的工具），解析器也随之升级，结构不变，字段可加。

解析出的结果分两个粒度使用：

- `list()` 只返回 `SkillMeta`（name + description）→ 给系统提示词
- `get(name)` 返回完整 `Skill`（含 body）→ 给 `load_skill` 工具

这个分离就是渐进式披露在代码里的形状：**提示词和正文从不混用同一个接口**。

## load_skill：加载即注入（load-skill.ts）

`load_skill` 是一个普通工具，工厂函数注入 `SkillRegistry`（和第四章 `createApprovalHook` 注入策略同一套路）：

```ts
const skill = skills.get(name);

context.loadedSkills.add(name);

return [
  `Skill "${skill.name}" loaded. Follow these instructions:`,
  "",
  skill.body,
].join("\n");
```

三个细节：

- **返回值即注入**，正文拼在 Observation 里返回，进入消息历史。不需要改 Agent 循环、不需要"激活"状态，上下文机制替你完成了一切
- **`loadedSkills` 去重**，模型重复加载同一个 skill 时直接告知"已加载，指令就在上面的历史里"，避免上下文被同一份指令刷屏
- **未知 skill 报错并列出可用的**，延续第一章"错误即反馈"：模型读错名字（比如 `load_skill("周报")`）会得到 `Unknown skill: 周报. Available skills: weekly-report, meeting-notes`，自行修正重试

权限上 `load_skill` 定为 `safe`：它只读本地文件、改一块内存状态，没有外部副作用。

## 提示词：Skills 一节的三个职责（main.ts）

```ts
{
  heading: "Skills",
  body: `
Available skills:
- weekly-report: ...
- meeting-notes: ...

If the user's task matches a skill's description, call
load_skill with its name BEFORE starting the task, then
follow the loaded instructions exactly.

If no skill matches, proceed without loading one.`,
},
```

这一节同时回答三个问题：**有什么**（技能清单）、**何时用**（任务匹配描述时，且要在动手之前）、**何时不用**（没有匹配就直接干活，和第六章"3 步以上才写 todo"同理，缺了这条模型会逢任务必先加载一个 skill）。

注意 description 的写法直接决定模型能不能匹配对。`Use whenever the user asks for a 周报` 这种带触发词的描述，是 skill 的路由表项，写 skill 的一半功夫在写 description 上。

## 本章的演示任务

`main.ts` 的任务故意**不提任何格式要求**：

```
我这周学习了两个主题：ReAct 和 tool calling。

请用 knowledge_search 分别搜索这两个主题的资料，
然后基于搜到的内容，给我写一份本周的学习周报。
```

格式规范全部在 `weekly-report/SKILL.md` 里。模型要想输出"本周进展 / 数据与结果 / 问题与风险 / 下周计划"的四段结构，唯一的途径就是先加载这个 skill。这正是渐进式披露想验证的行为：**指令不在提示词里，但任务完成得像在提示词里一样**。

## 运行

```bash
npx tsx 07Skills/main.ts
```

从日志里应该能看到：第一步（或写完 todo 后）模型调用 `load_skill({ name: "weekly-report" })`，随后的搜索结果收集和最终输出都遵循 skill 规定的结构。值得做的对照实验：

- **删掉 Skills 一节再跑**：模型不知道 skill 的存在，会凭自己的理解写周报，对比两次输出的结构差异，就是 skill 的价值
- **把任务换成"整理一份会议纪要"再跑**：同一个 Agent 加载另一个 skill，行为切换零代码

## 它的边界

- **skill 是软约束**，加载后遵不遵守仍靠模型自觉；如果某个格式必须强制（比如合规文档），老规矩，去钩子层校验输出
- **加载是单向的**，skill 一旦进入消息历史就待到运行结束，短任务无所谓，长任务里加载太多 skill 同样会稀释注意力，`loadedSkills` 去重只是底线，"哪些 skill 该被看到"本身也值得管理
- **正文是静态的**，本章的 skill 只有指令，没有附带脚本或资源文件。真实系统里 skill 往往还打包参考文档、模板甚至可执行脚本，加载时可以分层披露（先读主文件，再按指引读附件），机制相同，只是目录里多几个文件

## 动手练习

1. **技能内引用附件**：给 `weekly-report` 目录加一个 `example.md`（一份范文），在 SKILL.md 里写"输出前先阅读同目录的 example.md"。扩展 `load_skill`：返回正文时把附件路径列出来，模型再调用一个新工具 `read_skill_file(name, path)` 按需读取。体会分层披露为什么比一次性全量返回好。

2. **用钩子做硬校验**：weekly-report 要求四段结构缺一不可。写一个 `onRunEnd` 之前的拦截钩子：当最终答案看起来是周报（或 `loadedSkills` 包含 weekly-report）时，检查四个标题是否齐全，缺了就把答案打回让模型重写。想一想：钩子怎么拿到"最终答案"这个时机？（提示：和第六章练习 3 是同一个问题。）

3. **运行时注册技能**：现在技能目录只在启动时扫描一次。加一个新工具 `create_skill(name, description, body)`，让模型能把本次运行中总结出的一套流程**自己写成新 skill** 存入目录，下次运行即可加载。这是 Agent"积累经验"的雏形，同时想清楚：模型自己写的 skill 要不要过人审？权限分级该怎么定？
