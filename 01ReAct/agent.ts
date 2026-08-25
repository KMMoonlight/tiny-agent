import type {
  LLMClient,
  Message,
} from './llm.ts';


import type {
  Tool,
} from './tools.ts';

export class Agent {
  constructor(private readonly llm: LLMClient,
    private readonly tools: Map<string, Tool>,
  ) { }


  async run(
    question: string,
  ): Promise<string> {
    const messages: Message[] = [
      {
        role: "system",
        content: `
You are a helpful agent.
Use tools when necessary.`
      },
      {
        role: "user",
        content: question,
      },
    ];

    const definitions = [
      ...this.tools.values()
    ].map(tool => tool.definition);

    const maxSteps = 10;

    for (
      let step = 0;
      step < maxSteps;
      step++
    ) {
      console.log(
        `\n=================Step ${step + 1}==========`
      );

      const response = await this.llm.chat(messages, definitions);

      const choice = response.choices[0];

      if (!choice) {
        throw new Error(
          "LLM returned no choices",
        );
      }

      const message = choice.message;

      messages.push({
        role: "assistant",
        content: message.content,
        tool_calls: message.tool_calls,
      });

      const toolCalls = message.tool_calls ?? [];

      if (toolCalls.length === 0) {
        return (message.content ?? "");
      }

      for (const call of toolCalls) {
        const name = call.function.name;

        console.log("Action:", name);

        console.log("Action Input:", call.function.arguments);

        const tool = this.tools.get(name);

        let observation: unknown;

        if (!tool) {
          observation = {
            success: false,
            error: `Unknown tool: ${name}`,
          };
        } else {
          try {
            const args = JSON.parse(call.function.arguments);

            const result = await tool.execute(args);

            observation = {
              success: true,
              result,
            };
          } catch (error) {
            observation = {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }

        console.log("Observation:", observation);

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(observation),
        });
      }
    }

    throw new Error(
      "Agent reached max steps"
    );

  }
}
