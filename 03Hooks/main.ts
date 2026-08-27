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
  listNotesTool
} from "./notes.ts"

import {
  loggerHook
} from "./logger-hook.ts";

import {
  createMetricsHook
} from "./metrics-hook.ts";

import {
  guardHook
} from "./guard-hook.ts";

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
tools.register(listNotesTool);


const hooks = new HookManager();

hooks.register(loggerHook);
hooks.register(createMetricsHook());
hooks.register(guardHook);


const agent = new Agent(llm, tools, hooks);

async function main() {
  const answer = await agent.run(
    `完成下面任务：

    1. 使用 knowledge_search 搜索 ReAct Agent 的相关知识。
    2. 使用 text_stats 统计搜索结果内容的字符数。
    3. 使用 calculator 计算这个字符数乘以 3。
    4. 使用 current_time 查询 Asia/Tokyo 当前时间。
    5. 把计算结果和当前时间通过 save_note 保存，key 为 react_demo。
    6. 再使用 save_note 保存一条 key 为 sys_config 的笔记，内容随意。
    7. 使用 list_notes 确认哪些笔记保存成功了。
    8. 最后给我总结，并说明哪次保存失败了、原因是什么。

    这些步骤涉及的操作必须使用对应工具完成。
    `
  );
  console.log("\n================= FINAL ====================\n");
  console.log(answer);
}

main().catch(console.error);
