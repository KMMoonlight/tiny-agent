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


// 结构化错误：调用方只需要知道两件事——
// 失败时的 HTTP status，以及它"值不值得重试"（retryable）。
// 重试策略只看这两个字段做决策，不再解析错误消息字符串。
export class LLMError extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LLMError";
  }
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

    let response: Response;

    try {
      response = await fetch(url, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },

        body: JSON.stringify(body),

        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      // fetch 抛出的错误（连接失败、DNS 解析失败、超时等）统一归为一类：
      // 网络故障或超时是不确定故障，值得重试。
      throw new LLMError(
        [
          "LLM request failed",
          `cause: ${error instanceof Error ? error.message : String(error)}`,
        ].join("\n"),
        undefined,
        true,
      );
    }

    if (!response.ok) {
      const text = await response.text();

      // 可重试的错误：429（限流）、408（超时）与 5xx（服务端故障）——
      // 其余的 4xx 是请求本身有问题（认证失败、模型名错误、参数非法等），
      // 重试 100 次也不会成功。
      const retryable =
        response.status === 429 ||
        response.status === 408 ||
        response.status >= 500;

      throw new LLMError(
        [
          "LLM request failed",
          `status: ${response.status}`,
          `body: ${text}`,
        ].join("\n"),
        response.status,
        retryable,
      );
    }

    return await response.json() as ChatCompletionResponse;
  }
}
