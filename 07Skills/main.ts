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


const agent = new Agent(llm, tools, systemPrompt, hooks);

async function main() {
  const answer = await agent.run(
    `我这周学习了两个主题：ReAct 和 tool calling。

    请用 knowledge_search 分别搜索这两个主题的资料，
    然后基于搜到的内容，给我写一份本周的学习周报。
    `
  );
  console.log("\n================= FINAL ====================\n");
  console.log(answer);
}

main().catch(console.error);
