import type {
  ChatCompletionResponse,
  Message,
  ToolDefinition,
} from "./types.ts"


export interface LLMClient {
  chat(
    messages: Message[],
    tools?: ToolDefinition[],
  ): Promise<ChatCompletionResponse>;
}


export class OpenAICompatibleClient implements LLMClient {
  constructor(
    private readonly baseURL: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) { }

  async chat(
    messages: Message[],
    tools?: ToolDefinition[],
  ): Promise<ChatCompletionResponse> {
    const url = `${this.baseURL.replace(/\/$/, "")}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const response = await fetch(url, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },

      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();

      throw new Error(
        [
          "LLM request failed",
          `status: ${response.status}`,
          `body: ${text}`,
          ].join("\n"),
      );
    }

    return await response.json() as ChatCompletionResponse;
  }
}
