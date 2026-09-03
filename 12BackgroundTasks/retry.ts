import {
  LLMError
} from "./llm.ts";

import type {
  LLMClient
} from "./llm.ts";

import type {
  ChatCompletionResponse,
  Message,
  ToolDefinition,
} from "./types.ts";


export interface RetryConfig {
  // 最多额外重试几次（首次尝试不算）。maxRetries = 3 意味着最多发 4 次请求。
  maxRetries: number;

  // 指数退避的起点与上限：
  // 第 n 次重试前等待 baseDelayMs * 2^(n-1)，封顶 maxDelayMs。
  baseDelayMs: number;

  maxDelayMs: number;

  // 每次重试前回调一次：让重试从"看不见的等待"变成日志里的一个事件。
  onRetry?: (
    attempt: number,
    error: unknown,
    delayMs: number,
  ) => void;
}


function sleep(ms: number): Promise<void> {
  return new Promise(
    (resolve) => setTimeout(resolve, ms),
  );
}

// 未知错误一律不重试——它不在我们的错误分类之内，重试它没有任何依据。
function isRetryable(error: unknown): boolean {
  return error instanceof LLMError && error.retryable;
}


export class RetryingLLMClient implements LLMClient {
  constructor(
    private readonly inner: LLMClient,
    private readonly config: RetryConfig,
  ) { }

  async chat(
    messages: Message[],
    tools?: ToolDefinition[],
  ): Promise<ChatCompletionResponse> {
    let lastError: unknown;

    for (
      let attempt = 0;
      attempt <= this.config.maxRetries;
      attempt++
    ) {
      try {
        return await this.inner.chat(messages, tools);
      } catch (error) {
        lastError = error;

        // 两类情况立刻放弃：
        // 1. 错误不可重试（4xx、未知错误）——重试没有根据，是浪费请求。
        // 2. 已用尽重试次数——把错误原样抛给上层，不再无限拖延。
        if (
          !isRetryable(error) ||
          attempt === this.config.maxRetries
        ) {
          throw error;
        }

        const delayMs = Math.min(
          this.config.baseDelayMs * 2 ** attempt,
          this.config.maxDelayMs,
        );

        this.config.onRetry?.(attempt + 1, error, delayMs);

        await sleep(delayMs);
      }
    }

    throw lastError;
  }
}
