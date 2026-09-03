import type {
  LLMClient
} from "./llm.ts";

import type {
  Message
} from "./types.ts";

import {
  HookManager
} from "./hooks.ts";

import {
  ToolRegistry,
  type ToolContext,
  type ToolExecutionResult,
} from "./tool.ts";

import {
  compactMessages,
  estimateTokens,
  type CompactionConfig,
} from "./compact.ts";

import type {
  TaskManager
} from "./tasks.ts";

export class Agent {
  private readonly context: ToolContext = {
    notes: new Map<string, string>(),
    todos: [],
    loadedSkills: new Set<string>(),
  };

  constructor(
    private readonly llm: LLMClient,
    private readonly tools: ToolRegistry,
    private readonly systemPrompt: string,
    private readonly hooks: HookManager = new HookManager(),
    private readonly compaction?: CompactionConfig,
    private readonly backgroundTasks?: TaskManager,
  ) { }

  async run(
    question: string
  ): Promise<string> {
    await this.hooks.emitRunStart(question);

    let messages: Message[] = [
      {
        role: "system",
        content: this.systemPrompt
      },
      {
        role: "user",
        content: question
      }
    ];

    const definitions = this.tools.definitions();

    const maxSteps = 20;

    for (
      let step = 0;
      step < maxSteps;
      step++
    ) {
      await this.hooks.emitStepStart(step + 1);

      if (
        this.compaction &&
        estimateTokens(messages.slice(1)) > this.compaction.maxTokens
      ) {
        const result = await compactMessages(
          this.llm,
          messages,
          this.compaction,
        );

        if (result) {
          messages = result.messages;

          await this.hooks.emitCompact(
            result.beforeTokens,
            result.afterTokens,
            result.summary,
          );
        }
      }

      // 后台任务通知：把上一步以来完成的任务结果注入消息历史。
      // 模型不需要轮询——完成的消息会在下一次 LLM 请求时自然出现。
      if (this.backgroundTasks) {
        for (const task of this.backgroundTasks.drainFinished()) {
          messages.push({
            role: "user",
            content: [
              `[Background task finished: ${task.id} (${task.tool}) → ${task.status}]`,
              JSON.stringify(task.result ?? null),
            ].join("\n"),
          });
        }
      }

      const response = await this.llm.chat(messages, definitions);

      const choice = response.choices[0];

      if (!choice) {
        throw new Error("LLM returned no choices");
      }

      const assistant = choice.message;

      messages.push(assistant);

      const toolCalls = assistant.tool_calls ?? [];

      if (toolCalls.length === 0) {
        const answer = assistant.content ?? "";

        await this.hooks.emitRunEnd(answer, step + 1);

        return answer;
      }

      for (const call of toolCalls) {
        const toolName = call.function.name;

        let args: unknown;

        try {
          args = JSON.parse(call.function.arguments);
        } catch {
          args = {};
        }

        const decision = await this.hooks.emitToolCall(toolName, args);

        let observation: ToolExecutionResult;

        if (decision.action === "block") {
          observation = {
            success: false,
            error: `Tool call blocked: ${decision.reason}`,
          };
        } else {
          observation = await this.tools.execute(toolName, args, this.context);
        }

        await this.hooks.emitToolResult(toolName, args, observation);

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(observation)
        });
      }
    }

    throw new Error(`Agent exceeded ${maxSteps} steps`);
  }

}
