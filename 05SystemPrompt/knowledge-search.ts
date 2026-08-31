import type {
  Tool,
} from "./tool.ts";


const knowledgeBase = [
  {
    id: "react-agent",
    content: "ReAct is an agent pattern that combines reasoning an acting. The model reasons about the task, selects an action, receives an observation from the environment, and then continues reasoning.",
  },
  {
    id: "tool-calling",
    content: "Tool calling allows a language model to request that the host application execute external functions. The model does not execute the function itself."
  },
  {
    id: "agent-loop",
    content: "A typical agent loop repeatedly calls the language model, inspects tool calls, executes requested tools, appends observations to the conversation, and continues until the model returns a final answer."
  },
  {
    id: "tool-registry",
    content: "A Tool Registry manages available tools, exposes tool definitions to the language model, resolves tool names, executes tools, and returns execution results."
  }
];

type SearchArgs = {
  query: string;
};

export const knowledgeSearchTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "knowledge_search",
      description: "Search the local knowledge base. Use this tool when factual information about agents, ReAct or tool calling is required.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query"
          }
        },
        required: [
          "query"
        ],
        additionalProperties: false
      }
    }
  },

  execute(args) {
    const { query } = args as SearchArgs;

    if (typeof query !== "string") {
      throw new Error("query must be a string.");
    }

    const words = query.toLowerCase().split(/\s+/);

    const results = knowledgeBase.map(item => {
      const text = `${item.id} ${item.content}`.toLowerCase();

      const score = words.filter(word => text.includes(word)).length;

      return {
        ...item,
        score
      };
    }).filter(item => item.score > 0)
      .sort(
        (a, b) => b.score - a.score
      );

    return results;
  }
}
