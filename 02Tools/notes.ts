import type {
  Tool,
} from "./tool.ts";

type SaveNoteArgs = {
  key: string;
  content: string;
};

export const saveNoteTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "save_note",
      description: "Save information into the Agent runtime note storage.",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "Unique key of the note",
          },
          content: {
            type: "string",
            description: "Content to save"
          }
        },
        required: [
          "key",
          "content",
        ],
        additionalProperties: false
      }
    }
  },

  execute(args, context) {
    const { key, content } = args as SaveNoteArgs;

    if (typeof key !== "string" || typeof content !== "string") {
      throw new Error("invalid note");
    }

    context.notes.set(key, content);

    return {
      saved: true,
      key
    };
  }
}


export const listNotesTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "list_notes",
      description: "List all notes currently stored in the Agent runtime.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  },
  execute(
    _args,
    context
  ) {
    return Object.fromEntries(context.notes.entries());
  }
}
