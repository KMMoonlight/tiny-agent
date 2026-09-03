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
  CronManager,
  createCronTool,
  createListCronsTool,
  createDeleteCronTool,
  type CronJob,
} from "./cron.ts";

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


const taskManager = new TaskManager(tools);

tools.register(createRunInBackgroundTool(taskManager, defaultPolicy));
tools.register(createCheckTaskTool(taskManager));
tools.register(createListTasksTool(taskManager));


// 调度器在 agent 之外：每次触发就是一次全新的 agent.run，
// agent.ts 一行不用改。
// agent 在下方才构造，但 onFire 只会在模型创建任务之后触发，
// 那时 agent 必定已经就位。
const MAX_FIRES = 2;

let fires = 0;

let agent!: Agent;

const cron = new CronManager(async (job: CronJob) => {
  fires++;

  console.log(
    `\n########## CRON FIRED #${fires}: ${job.id} ##########`,
  );
  console.log(`prompt: ${job.prompt}\n`);

  const answer = await agent.run(job.prompt);

  console.log(answer);

  if (fires >= MAX_FIRES) {
    console.log(
      `\n########## 已演示 ${MAX_FIRES} 次触发，停止调度器 ##########`,
    );
    console.log(cron.list());
    cron.stop();
    process.exit(0);
  }
});

tools.register(createCronTool(cron));
tools.register(createListCronsTool(cron));
tools.register(createDeleteCronTool(cron));

cron.start();


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
      heading: "Cron Tasks",
      body: `
You can schedule work to happen LATER with create_cron.

1. create_cron takes a 5-field cron expression
   (minute hour day-of-month month day-of-week) and a
   prompt. Examples:
   - "*/5 * * * *"  every 5 minutes
   - "30 9 * * *"   every day at 09:30
   - "0 9 * * 1-5"  weekdays at 09:00

2. Set recurring=false for a one-shot reminder;
   it fires once and deletes itself.

3. Each fire is a FRESH run that cannot see this
   conversation. Write the prompt so it is fully
   self-contained: what to do, for whom, in what form.

4. Use list_crons to see what is scheduled and
   delete_cron to cancel a task (needs approval).`,
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


agent = new Agent(
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
  console.log("\n########## RUN：让模型自己设置一个定时任务 ##########");

  await agent.run(
    `帮我设置一个定时任务：每分钟提醒我站起来活动一下、喝口水。
     用 recurring 模式。设置好后告诉我任务 id 和下一次触发时间。`
  );

  console.log(
    "\n########## 调度器运行中，等待定时触发（约两分钟自动结束） ##########",
  );
}

main().catch(console.error);
