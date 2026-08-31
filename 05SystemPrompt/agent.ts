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

export class Agent {
  private readonly context: ToolContext = {
    notes: new Map<string, string>(),
  };

  constructor(
    private readonly llm: LLMClient,
    private readonly tools: ToolRegistry,
    private readonly systemPrompt: string,
    private readonly hooks: HookManager = new HookManager()
  ) { }

  async run(
    question: string
  ): Promise<string> {
    await this.hooks.emitRunStart(question);

    const messages: Message[] = [
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
