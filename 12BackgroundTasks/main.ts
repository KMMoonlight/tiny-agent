import "dotenv/config";

import {
  OpenAICompatibleClient,
} from "./llm.ts";

import {
  RetryingLLMClient
} from "./retry.ts";

import {
  ToolRegistry
} from "./tool.ts";

import {
  HookManager
} from "./hooks.ts";

import {
  Agent
} from "./agent.ts";

import {
  buildSystemPrompt
} from "./prompt.ts";

import {
  calculatorTool
} from "./calculator.ts";

import {
  textStatsTool
} from "./text-stats.ts";

import {
  currentTimeTool
} from "./current-time.ts";

import {
  knowledgeSearchTool
} from "./knowledge-search.ts";

import {
  saveNoteTool,
  deleteNoteTool,
  listNotesTool
} from "./notes.ts"

import {
  writeTodoTool
} from "./todo.ts";

import {
  SkillRegistry
} from "./skill.ts";

import {
  createLoadSkillTool
} from "./load-skill.ts";

import {
  createSpawnSubagentTool,
  type SubagentSpec,
} from "./subagent.ts";

import {
  MemoryStore,
  createSaveMemoryTool,
  createSearchMemoryTool,
} from "./memory.ts";

import {
  TaskManager,
  createRunInBackgroundTool,
  createCheckTaskTool,
  createListTasksTool,
} from "./tasks.ts";

import {
  fileURLToPath
} from "node:url";

import {
  join
} from "node:path";

import {
  loggerHook
} from "./logger-hook.ts";

import {
  createMetricsHook
} from "./metrics-hook.ts";

import {
  defaultPolicy
} from "./permission.ts";

import {
  createApprovalHook
} from "./approval-hook.ts";

const baseURL = process.env.LLM_BASE_URL;
const apiKey = process.env.LLM_API_KEY;
const model = process.env.LLM_MODEL;

if (!baseURL) {
  throw new Error(
    "LLM_BASE_URL is missing",
  );
}

if (!apiKey) {
  throw new Error(
    "LLM_API_KEY is missing",
  );
}

if (!model) {
  throw new Error(
    "LLM_MODEL is missing",
  );
}

const llm = new RetryingLLMClient(
  new OpenAICompatibleClient(
    baseURL,
    apiKey,
    model,
  ),
  {
    maxRetries: 3,
    baseDelayMs: 1_000,
    maxDelayMs: 8_000,

    onRetry: (attempt, error, delayMs) => {
      console.log(
        `\n  [retry] attempt #${attempt} failed, waiting ${delayMs}ms before the next attempt...`,
      );
    },
  },
);


const tools = new ToolRegistry();

tools.register(calculatorTool);
tools.register(textStatsTool);
tools.register(currentTimeTool);
tools.register(knowledgeSearchTool);
tools.register(saveNoteTool);
tools.register(deleteNoteTool);
tools.register(listNotesTool);
tools.register(writeTodoTool);

const skills = new SkillRegistry();

skills.loadDir(
  join(fileURLToPath(new URL(".", import.meta.url)), "skills"),
);

tools.register(createLoadSkillTool(skills));


const subagents: SubagentSpec[] = [
  {
    name: "researcher",

    description:
      "Researches one topic with the local knowledge base. "
      + "Searches the topic, measures the result, and reports "
      + "a one-sentence takeaway plus exact character counts.",

    // 子代理的工具子集：
    // 它不需要 notes、todo、skill，更不能派生新的子代理
    tools: [
      knowledgeSearchTool,
      textStatsTool,
    ],

    systemPrompt: `
You are a research subagent.

You receive ONE self-contained task and must complete it
with your tools, then report back.

Rules:
1. Never fabricate a tool result.
2. Keep every exact number from tool results in your
   final answer — the caller sees ONLY your final answer,
   not your intermediate steps. Anything you leave out is lost.
3. Always answer in Simplified Chinese.`,
  },
];

tools.register(createSpawnSubagentTool(llm, subagents));


const memory = new MemoryStore(
  join(fileURLToPath(new URL(".", import.meta.url)), "memory.json"),
);

tools.register(createSaveMemoryTool(memory));
tools.register(createSearchMemoryTool(memory));


// 后台任务管理器：run_in_background 启动的任务在这里排队、执行、记录状态。
// 它被注册成工具，也被传进 Agent——
// 前者让模型能启动任务，后者让主循环能注入完成通知。
const taskManager = new TaskManager(tools);

tools.register(createRunInBackgroundTool(taskManager, defaultPolicy));
tools.register(createCheckTaskTool(taskManager));
tools.register(createListTasksTool(taskManager));


const hooks = new HookManager();

hooks.register(loggerHook);
hooks.register(createMetricsHook());
hooks.register(createApprovalHook(defaultPolicy));


const systemPrompt = buildSystemPrompt(
  [
    {
      heading: "Role",
      body: `
You are a helpful Agent.
You have access to external tools.

Your job is not merely to answer directly.

When a task requires information, calculation,
external state, storage or another capability,
use the appropriate tool.`,
    },
    {
      heading: "Tool Rules",
      body: `
1. Never fabricate a tool result.

2. If a tool can provide a more reliable answer,
   prefer using the tool.

3. You may call multiple tools, sequentially or in parallel.

4. A later tool call may depend on the Observation
   returned by an earlier tool.

5. If the Runtime Context below already contains the answer,
   answer directly without calling a tool.

6. Only return the final answer when the task is complete.

The host application executes tools.
You only request tool calls.`,
    },
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
    {
      heading: "Skills",
      body: `
Skills are reusable instruction packages for specialized
tasks. Only their names and descriptions are listed here;
the full instructions are loaded on demand.

Available skills:
${skills.list().map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")}

If the user's task matches a skill's description, call
load_skill with its name BEFORE starting the task, then
follow the loaded instructions exactly.

If no skill matches, proceed without loading one.`,
    },
    {
      heading: "Subagents",
      body: `
You can delegate self-contained subtasks to subagents
with spawn_subagent.

1. A subagent runs with its own isolated context.
   It cannot see this conversation; the task you write
   is the ONLY input it gets. Make the task complete
   and self-contained.

2. A subagent returns only its final answer. State
   exactly what that answer must contain (facts,
   exact numbers) — anything it leaves out is lost.

3. Delegate when a subtask would flood your context
   with intermediate results you do not need.
   Do the final synthesis yourself.`,
    },
    {
      heading: "Background Tasks",
      body: `
Long tool calls can run in the BACKGROUND with
run_in_background instead of blocking a step.

1. run_in_background returns a task id IMMEDIATELY.
   The task keeps running while you do other work.

2. When a background task finishes, its result arrives
   automatically as a [Background task finished] message.
   You do not need to poll — but check_task is available
   if you must know a task's status right now.

3. Delegate independent long-running work (such as
   subagent research) to background tasks IN PARALLEL,
   then do your own foreground work while they run.

4. When a task's result arrives, USE it. Never start
   the same task again.`,
    },
    {
      heading: "Memory",
      body: `
Your message history is forgotten when the run ends.
Long-term memory is not — it persists ACROSS runs.

1. save_memory: record STABLE facts about the user
   (identity, preferences, allergies). Never save
   transient task state — that is what notes and
   todos are for.

2. search_memory: when the user's request may depend
   on something they told you in a PREVIOUS run,
   search memory first instead of claiming you do
   not know.

3. If a fact will matter next time, it must be in
   memory. If it only matters now, keep it out.`,
    },
    {
      heading: "Runtime Context",
      body: (context) => `
Current time: ${context.now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}

Available tools:
${context.tools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n")}`,
    },
    {
      heading: "Output Format",
      body: `
Always answer in Simplified Chinese.

Your final answer must use exactly this structure:

【结论】The direct answer to the user's question.
【依据】The key facts or tool results the conclusion is based on.
【工具】The tools you used, in the order you called them.
        If you used no tool at all, write "无".`,
    },
  ],
  {
    now: new Date(),

    tools: tools.definitions().map((definition) => ({
      name: definition.function.name,
      description: definition.function.description ?? "",
    })),
  }
);

console.log("=============== SYSTEM PROMPT ===============\n");
console.log(systemPrompt);
console.log("\n=============================================\n");


const agent = new Agent(
  llm,
  tools,
  systemPrompt,
  hooks,
  {
    maxTokens: 400,
    keepRecent: 6,
  },
  taskManager,
);

async function main() {
  console.log("\n########## RUN：两个后台研究任务 + 前台计算 ##########");

  // 这个任务是精心设计的：
  // 两个相互独立的子代理研究（慢，适合后台）+
  // 一个前台计算（快，模型等任务的时候可以顺手做掉）。
  // 观察模型是否并行启动两个后台任务、在等待期间做计算，
  // 并在通知到达后把三者汇总。
  const answer = await agent.run(
    `我要同时了解两个主题：
     1. ReAct pattern 是什么
     2. tool calling 是什么
     请用 run_in_background 分别派 researcher 子代理去研究这两个主题（两个任务并行启动）。
     等它们跑的时候，帮我算一下 123 × 456 等于多少。
     最后把两个研究结论和计算结果一起汇总给我。`
  );

  console.log("\n================= FINAL ====================\n");
  console.log(answer);

  console.log("\n================= TASKS ====================\n");
  console.log(taskManager.list());
}

main().catch(console.error);
