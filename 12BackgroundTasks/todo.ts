import type {
  Tool,
  TodoItem,
  TodoStatus,
} from "./tool.ts";

const VALID_STATUSES: TodoStatus[] = [
  "pending",
  "in_progress",
  "completed",
];

const STATUS_MARKS: Record<TodoStatus, string> = {
  pending: "[ ]",
  in_progress: "[>]",
  completed: "[x]",
};

export function renderTodoList(
  todos: TodoItem[],
): string {
  if (todos.length === 0) {
    return "Todo list is empty.";
  }

  return todos
    .map((todo) => `${STATUS_MARKS[todo.status]} ${todo.content}`)
    .join("\n");
}

export const writeTodoTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "write_todo",
      description: "Plan and track a multi-step task. Rewrite the FULL todo list on every call: mark finished steps completed, keep exactly one step in_progress, leave the rest pending.",

      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            description: "The complete todo list. It replaces the previous list entirely.",

            items: {
              type: "object",
              properties: {
                content: {
                  type: "string",
                  description: "What this step does"
                },
                status: {
                  type: "string",
                  enum: [
                    "pending",
                    "in_progress",
                    "completed"
                  ],
                },
              },
              required: [
                "content",
                "status",
              ],
              additionalProperties: false
            },
          },
        },
        required: [
          "todos",
        ],
        additionalProperties: false
      },
    }
  },

  execute(args, context) {
    const { todos } = args as { todos?: unknown };

    if (!Array.isArray(todos) || todos.length === 0) {
      throw new Error(
        "todos must be a non-empty array",
      );
    }

    const parsed: TodoItem[] = todos.map((item, index) => {
      const todo = item as Partial<TodoItem>;

      if (
        typeof todo?.content !== "string" ||
        todo.content.trim() === ""
      ) {
        throw new Error(
          `todos[${index}].content must be a non-empty string`,
        );
      }

      if (!VALID_STATUSES.includes(todo.status as TodoStatus)) {
        throw new Error(
          `todos[${index}].status must be one of: ${VALID_STATUSES.join(", ")}`,
        );
      }

      return {
        content: todo.content,
        status: todo.status as TodoStatus,
      };
    });

    const inProgress = parsed.filter(
      (todo) => todo.status === "in_progress",
    );

    if (inProgress.length > 1) {
      throw new Error(
        `expected at most one in_progress task, got ${inProgress.length}`,
      );
    }

    context.todos = parsed;

    return `Todo list updated:\n${renderTodoList(parsed)}`;
  }
}
