import type {
  Tool,
} from "./tool.ts";


type TextStatsArgs = {
  text: string;
};

export const textStatsTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "text_stats",
      description: "Calculate statistics about a piece of text, including characters, words and lines.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Text to analyze",
          }
        },
        required: [
          "text"
        ],
        additionalProperties: false
      }
    }
  },

  execute(args) {

    const { text } = args as TextStatsArgs;

    if (typeof text !== "string") {
      throw new Error(
        "text must be a string",
      );
    }

    return {
      characters: text.length,
      characterWithoutSpaces: text.replace(/\s/g, "").length,
      words: text.trim().split(/\s+/).filter(Boolean).length,
      lines: text.split(/\r?\n/).length,
    };
  }
}
