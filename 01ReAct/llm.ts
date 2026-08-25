import "dotenv/config";

export type ToolDefinition = {
  type: "function";

  function: {
    name: string;
    description?: string;

    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
};

export type ToolCall = {
  id: string;
  type: "function";

  function: {
    name: string;
    arguments: string;
  }
};

export type Message =
  | {
    role: "system";
    content: string;
  }
  | {
    role: "user";
    content: string;
  }
  | {
    role: "assistant";
    content: string | null;
    tool_calls?: ToolCall[];
  }
  | {
    role: "tool";
    tool_call_id: string;
    content: string;
  };


export type ChatResponse = {
  id: string;

  choices: Array<{
    index: number;

    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: ToolCall[];
    };

    finish_reason: string | null;
  }>;
};


export interface LLMClient {
  chat(
    messages: Message[],
    tools?: ToolDefinition[],
  ): Promise<ChatResponse>;
}



export class OpenAICompatibleClient implements LLMClient {
  constructor(private readonly baseURL: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) { }

  async chat(
    messages: Message[],
    tools?: ToolDefinition[],
  ): Promise<ChatResponse> {
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
        `LLM request failed\n` +
        `status: ${response.status}\n` +
        `body: ${text}`,
      );
    }

    return await response.json() as ChatResponse;
  }
}



export function createLLMClient(): LLMClient {
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

  return new OpenAICompatibleClient(
    baseURL,
    apiKey,
    model,
  );
}
