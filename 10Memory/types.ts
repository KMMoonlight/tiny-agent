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
  };
};


export type SystemMessage = {
  role: "system";
  content: string;
};

export type UserMessage = {
  role: "user";
  content: string;
};

export type AssistantMessage = {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
};

export type ToolMessage = {
  role: "tool";
  tool_call_id: string;
  content: string;
};

export type Message =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage;


export type ChatCompletionResponse = {
  id: string;

  choices: Array<{
    index: number;

    message: AssistantMessage;

    finish_reason: string | null;
  }>;
};
