import "dotenv/config";

import {
  OpenAICompatibleClient,
} from "./llm.ts";

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

const llm = new OpenAICompatibleClient(
  baseURL,
  apiKey,
  model
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
   not your intermediate steps. Anything you leave out
   is lost.
3. Always answer in Simplified Chinese.`,
  },
];

tools.register(createSpawnSubagentTool(llm, subagents));


const memory = new MemoryStore(
  join(fileURLToPath(new URL(".", import.meta.url)), "memory.json"),
);

tools.register(createSaveMemoryTool(memory));
tools.register(createSearchMemoryTool(memory));


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


const agent = new Agent(llm, tools, systemPrompt, hooks, {
  maxTokens: 400,
  keepRecent: 6,
});

async function main() {
  console.log("\n########## RUN 1：告诉 Agent 一些事实 ##########");

  await agent.run(
    `请记住关于我的三件事：
    1. 我的猫叫年糕，生日是 2022 年 3 月 15 日。
    2. 我对花生过敏。
    3. 我住在上海。
    记住之后告诉我你记住了什么。`
  );

  // 第二次 run 是一个全新的对话：消息历史从零开始，
  // 上一次 run 的对话内容模型一行也看不到。
  // 它能回答的唯一途径，是从长期记忆里把事实捞回来。
  console.log("\n########## RUN 2：全新对话，考考它的记忆 ##########");

  const answer = await agent.run(
    `我的猫叫什么名字、生日是哪天？
    我想给它办个生日会，结合我的情况，推荐两款我也能吃的零食。`
  );

  console.log("\n================= FINAL ====================\n");
  console.log(answer);
}

main().catch(console.error);
