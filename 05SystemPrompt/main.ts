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
    `完成下面任务：

    1. 今天是几号、现在几点？直接使用系统提示中 Runtime Context 给出的信息回答，不要调用工具。
    2. 使用 knowledge_search 搜索 ReAct Agent 的相关知识。
    3. 使用 text_stats 统计搜索结果内容的字符数。
    4. 把统计结果通过 save_note 保存，key 为 prompt_demo。
    5. 严格按照系统提示中 Output Format 规定的结构，给我最终总结。

    第 2 到第 4 步必须使用对应工具完成。
    `
  );
  console.log("\n================= FINAL ====================\n");
  console.log(answer);
}

main().catch(console.error);
