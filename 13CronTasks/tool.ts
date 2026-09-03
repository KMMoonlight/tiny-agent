import type {
  ToolDefinition
} from "./types.ts"


export type TodoStatus =
  | "pending"
  | "in_progress"
  | "completed";

export type TodoItem = {
  content: string;

  status: TodoStatus;
};

export type ToolContext = {
  notes: Map<string, string>;

  todos: TodoItem[];

  loadedSkills: Set<string>;
};

export interface Tool {
  definition: ToolDefinition;

  execute(
    args: unknown,
    context: ToolContext,
  ): unknown | Promise<unknown>;
}


export type ToolExecutionResult =
  | {
    success: true;
    result: unknown;
  }
  | {
    success: false;
    error: string;
  };


export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {

    const name = tool.definition.function.name;

    if (this.tools.has(name)) {
      throw new Error(`Tool already exists: ${name}`);
    }

    this.tools.set(name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  definitions(): ToolDefinition[] {
    return [
      ...this.tools.values(),
    ].map(
      tool => tool.definition,
    );
  }

  async execute(
    name: string,
    args: unknown,
    context: ToolContext,
  ): Promise<ToolExecutionResult> {

    const tool = this.tools.get(name);

    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${name}`,
      };
    }

    try {
      const result = await tool.execute(
        args,
        context,
      );

      return {
        success: true,
        result,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
