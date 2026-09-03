import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

import type {
  Tool,
} from "./tool.ts";


export type MemoryEntry = {
  id: string;

  content: string;

  createdAt: string;
};

// 长期记忆：持久化到一个 JSON 文件，
// 进程退出、机器重启后仍在。
// 与 notes（ToolContext 里的 Map，随单次运行消亡）
// 形成"工作记忆 vs 长期记忆"的对照。
export class MemoryStore {
  private entries: MemoryEntry[] = [];

  constructor(
    private readonly filePath: string,
  ) {
    if (existsSync(filePath)) {
      this.entries = JSON.parse(
        readFileSync(filePath, "utf-8"),
      ) as MemoryEntry[];
    }
  }

  save(content: string): MemoryEntry {
    const entry: MemoryEntry = {
      id: `mem-${this.entries.length + 1}`,
      content,
      createdAt: new Date().toISOString(),
    };

    this.entries.push(entry);

    // 写入即落盘——记忆的价值就在于进程死了它还在
    writeFileSync(
      this.filePath,
      JSON.stringify(this.entries, null, 2),
    );

    return entry;
  }

  search(query: string): MemoryEntry[] {
    const words = query.toLowerCase().split(/\s+/);

    return this.entries
      .map((entry) => ({
        entry,
        score: words.filter(
          (word) => entry.content.toLowerCase().includes(word)
        ).length,
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ entry }) => entry);
  }
}


type SaveMemoryArgs = {
  content: string;
};

export function createSaveMemoryTool(
  store: MemoryStore,
): Tool {
  return {
    definition: {
      type: "function",
      function: {
        name: "save_memory",

        description: [
          "Save a stable fact into long-term memory.",
          "Memory persists ACROSS runs, unlike your message",
          "history which is forgotten when the run ends.",
          "Save user preferences, identity and other durable",
          "facts — NOT transient task state.",
        ].join(" "),

        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The fact to remember, as one clear sentence",
            },
          },
          required: ["content"],
          additionalProperties: false,
        },
      },
    },

    execute(args) {
      const { content } = args as SaveMemoryArgs;

      if (typeof content !== "string" || !content.trim()) {
        throw new Error("content must be a non-empty string");
      }

      const entry = store.save(content.trim());

      return {
        saved: true,
        id: entry.id,
      };
    },
  };
}


type SearchMemoryArgs = {
  query: string;
};

export function createSearchMemoryTool(
  store: MemoryStore,
): Tool {
  return {
    definition: {
      type: "function",
      function: {
        name: "search_memory",

        description: [
          "Search long-term memory for facts saved in",
          "previous runs. Use it whenever the user's request",
          "may depend on something they told you before,",
          "instead of claiming you do not know.",
        ].join(" "),

        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query",
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
    },

    execute(args) {
      const { query } = args as SearchMemoryArgs;

      if (typeof query !== "string") {
        throw new Error("query must be a string.");
      }

      const results = store.search(query);

      if (results.length === 0) {
        return {
          found: false,
          message: "No memories matched. The fact may never have been saved.",
        };
      }

      return {
        found: true,
        memories: results,
      };
    },
  };
}
