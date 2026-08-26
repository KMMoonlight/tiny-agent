import type {
  LLMClient
} from "./llm.ts";

import type {
  Message
} from "./types.ts";

import {
  ToolRegistry,
  type ToolContext,
} from "./tool.ts";

export class Agent {
  private readonly context: ToolContext = {
    notes: new Map<string, string>(),
  };

  constructor(
    private readonly llm: LLMClient,
    private readonly tools: ToolRegistry
  ) { }

  async run(
    question: string
  ): Promise<string> {
    const messages: Message[] = [
      {
        role: "system",
        content: `
You are a helpful Agent.
You have access to external tools.

Your job is not merely to answer directly.

When a task requires information, calculation,
external state, storage or another capability,
use the appropriate tool.

Important rules:

1. Never fabricate a tool result.

2. If a tool can provide a more reliable answer,
   prefer using the tool.

3. You may call multiple tools.

4. You may call tools sequentially.

5. A later tool call may depend on the Observation
   returned by an earlier tool.

6. After receiving tool results,
   reason about whether another tool is needed.

7. Only return the final answer when the task is complete.

The host application executes tools.
You only request tool calls.`.trim()
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
      console.log(`\n===============Agent Step ${step + 1} ==============`);

      const response = await this.llm.chat(messages, definitions);

      const choice = response.choices[0];

      if (!choice) {
        throw new Error("LLM returned no choices");
      }

      const assistant = choice.message;

      messages.push(assistant);

      const toolCalls = assistant.tool_calls ?? [];

      if (toolCalls.length === 0) {
        console.log("\nAgent returned Final Answer");

        return (assistant.content ?? "");
      }

      for (const call of toolCalls) {
        const toolName = call.function.name;

        console.log("\nAction:", toolName);

        console.log("Action Input:", call.function.arguments);

        let args: unknown;

        try {
          args = JSON.parse(call.function.arguments);
        } catch {
          args = {};
        }


        const observation = await this.tools.execute(toolName, args, this.context);

        console.log("Observation:", observation);

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
