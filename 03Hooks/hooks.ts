import type {
  ToolExecutionResult
} from "./tool.ts";


export type ToolCallDecision =
  | {
    action: "allow";
  }
  | {
    action: "block";
    reason: string;
  };


export interface AgentHooks {
  onRunStart?(
    question: string,
  ): void | Promise<void>;

  onStepStart?(
    step: number,
  ): void | Promise<void>;

  onToolCall?(
    name: string,
    args: unknown,
  ): void | ToolCallDecision | Promise<void | ToolCallDecision>;

  onToolResult?(
    name: string,
    args: unknown,
    result: ToolExecutionResult,
  ): void | Promise<void>;

  onRunEnd?(
    answer: string,
    steps: number,
  ): void | Promise<void>;
}


export class HookManager {
  private readonly hooks: AgentHooks[] = [];

  register(hook: AgentHooks): void {
    this.hooks.push(hook);
  }

  async emitRunStart(
    question: string,
  ): Promise<void> {
    for (const hook of this.hooks) {
      await hook.onRunStart?.(question);
    }
  }

  async emitStepStart(
    step: number,
  ): Promise<void> {
    for (const hook of this.hooks) {
      await hook.onStepStart?.(step);
    }
  }

  async emitToolCall(
    name: string,
    args: unknown,
  ): Promise<ToolCallDecision> {
    for (const hook of this.hooks) {
      const decision = await hook.onToolCall?.(name, args);

      if (decision?.action === "block") {
        return decision;
      }
    }

    return {
      action: "allow",
    };
  }

  async emitToolResult(
    name: string,
    args: unknown,
    result: ToolExecutionResult,
  ): Promise<void> {
    for (const hook of this.hooks) {
      await hook.onToolResult?.(name, args, result);
    }
  }

  async emitRunEnd(
    answer: string,
    steps: number,
  ): Promise<void> {
    for (const hook of this.hooks) {
      await hook.onRunEnd?.(answer, steps);
    }
  }
}
