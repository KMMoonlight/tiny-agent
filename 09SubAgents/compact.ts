import type {
  LLMClient
} from "./llm.ts";

import type {
  Message
} from "./types.ts";


export type CompactionConfig = {
  // 消息历史（不含 system prompt）估算 token 数超过该值时触发压缩
  maxTokens: number;

  // 压缩时保留最近 N 条消息不动
  keepRecent: number;
};

export type CompactionResult = {
  messages: Message[];

  summary: string;

  beforeTokens: number;

  afterTokens: number;
};


// 粗略估算：一个中文字符约 1 token，其余字符约 4 个 1 token。
// 只用于触发判断，不需要精确。
export function estimateTokens(
  messages: Message[],
): number {
  let cjk = 0;
  let other = 0;

  for (const message of messages) {
    let text = typeof message.content === "string"
      ? message.content
      : "";

    if (message.role === "assistant") {
      for (const call of message.tool_calls ?? []) {
        text += call.function.name + call.function.arguments;
      }
    }

    for (const ch of text) {
      if (/[一-鿿]/.test(ch)) {
        cjk++;
      } else {
        other++;
      }
    }
  }

  return cjk + Math.ceil(other / 4);
}


function serialize(
  messages: Message[],
): string {
  return messages.map((message) => {
    switch (message.role) {
      case "system":
        return `SYSTEM: ${message.content}`;

      case "user":
        return `USER: ${message.content}`;

      case "assistant": {
        const parts: string[] = [];

        if (message.content) {
          parts.push(message.content);
        }

        for (const call of message.tool_calls ?? []) {
          parts.push(
            `[calls ${call.function.name}(${call.function.arguments})]`,
          );
        }

        return `ASSISTANT: ${parts.join(" ")}`;
      }

      case "tool":
        return `TOOL: ${message.content}`;
    }
  }).join("\n\n");
}


async function summarize(
  llm: LLMClient,
  messages: Message[],
): Promise<string> {
  const response = await llm.chat([
    {
      role: "user",
      content: `You are compacting the conversation history of an AI agent that is in the middle of a task.

Write a concise summary that lets the agent continue WITHOUT the original messages. Preserve:

1. The user's original task, including all explicit requirements.
2. Steps already completed, with key results kept EXACT (numbers, names, values from tool results).
3. The current todo list state, if there is one.
4. What remains to be done.

Keep the summary under 300 words. Quote exact numbers and key
values, but paraphrase long passages instead of copying them
verbatim.

Conversation so far:

${serialize(messages)}`,
    },
  ]);

  const content = response.choices[0]?.message.content;

  if (!content) {
    throw new Error("Summarization returned no content");
  }

  return content;
}


// 把消息历史压缩成：system prompt + 摘要 + 最近 N 条消息。
// 历史太短（中间没有可压缩的部分）时返回 null。
export async function compactMessages(
  llm: LLMClient,
  messages: Message[],
  config: CompactionConfig,
): Promise<CompactionResult | null> {
  let tailStart = Math.max(1, messages.length - config.keepRecent);

  // tail 不能以 tool 消息开头：tool 消息必须跟在发起它的
  // assistant 消息后面，所以向前回溯把那条 assistant 一起保留
  while (tailStart > 1 && messages[tailStart]?.role === "tool") {
    tailStart--;
  }

  const middle = messages.slice(1, tailStart);

  if (middle.length === 0) {
    return null;
  }

  const beforeTokens = estimateTokens(messages.slice(1));

  const summary = await summarize(llm, middle);

  const compacted: Message[] = [
    messages[0]!,
    {
      role: "user",
      content: [
        "[Context compacted] The earlier conversation was summarized",
        "to fit the context budget. Here is the summary of earlier work:",
        "",
        summary,
        "",
        "Continue the task based on this summary and the recent messages below.",
      ].join("\n"),
    },
    ...messages.slice(tailStart),
  ];

  return {
    messages: compacted,
    summary,
    beforeTokens,
    afterTokens: estimateTokens(compacted.slice(1)),
  };
}
