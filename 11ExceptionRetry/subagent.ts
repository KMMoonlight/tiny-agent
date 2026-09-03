import type {
  LLMClient
} from "./llm.ts";

import {
  Agent
} from "./agent.ts";

import {
  HookManager
} from "./hooks.ts";

import {
  ToolRegistry,
  type Tool,
} from "./tool.ts";

import {
  createLoggerHook
} from "./logger-hook.ts";


export type SubagentSpec = {
  // 子代理的名字，父 Agent 用它来选择派给谁
  name: string;

  // 给父 Agent 看的能力说明，
  // 写进 spawn_subagent 的工具描述里
  description: string;

  // 该子代理可用的工具子集——
  // 子代理的权限边界
  tools: Tool[];

  // 子代理自己的系统提示词
  systemPrompt: string;
};

export function createSpawnSubagentTool(
  llm: LLMClient,
  subagents: SubagentSpec[],
): Tool {
  const specs = new Map(
    subagents.map(
      (spec) => [spec.name, spec]
    ),
  );

  return {
    definition: {
      type: "function",

      function: {
        name: "spawn_subagent",

        description: [
          "Delegate a self-contained subtask to a subagent.",
          "",
          "The subagent runs with its OWN isolated context.",
          "It cannot see this conversation; the task you write",
          "is the ONLY input it gets. It returns only its",
          "final answer, not its intermediate steps.",
          "",
          "Available subagents:",
          ...subagents.map(
            (spec) => `- ${spec.name}: ${spec.description}`
          ),
        ].join("\n"),

        parameters: {
          type: "object",

          properties: {
            agent: {
              type: "string",
              enum: subagents.map((spec) => spec.name),
              description: "Which subagent to delegate to.",
            },

            task: {
              type: "string",
              description: [
                "A complete, self-contained task description.",
                "Include every piece of context the subagent",
                "needs, and state exactly what its final answer",
                "must contain.",
              ].join(" "),
            },
          },

          required: ["agent", "task"],

          additionalProperties: false,
        },
      },
    },

    async execute(args) {
      const { agent, task } = args as {
        agent?: string;
        task?: string;
      };

      const spec = agent ? specs.get(agent) : undefined;

      if (!spec) {
        throw new Error(`Unknown subagent: ${agent}`);
      }

      if (!task) {
        throw new Error("task is required");
      }

      // 每次调用都 new 一个 Agent：
      // 全新的消息历史、全新的 ToolContext，
      // 子代理之间、子代理与父代理之间互不可见
      const tools = new ToolRegistry();

      for (const tool of spec.tools) {
        tools.register(tool);
      }

      const hooks = new HookManager();

      hooks.register(
        createLoggerHook(`[${spec.name}] `)
      );

      const subagent = new Agent(
        llm,
        tools,
        spec.systemPrompt,
        hooks,
      );

      const answer = await subagent.run(task);

      // 父 Agent 只能看到这一句最终答案，
      // 子代理中间的推理和工具结果都不会
      // 进入父的消息历史
      return {
        agent: spec.name,
        answer,
      };
    },
  };
}
