import type {
  Tool,
  ToolContext,
  ToolExecutionResult,
  ToolRegistry,
} from "./tool.ts";

import {
  riskLevelOf,
  type PermissionPolicy,
} from "./permission.ts";


export type TaskStatus =
  | "running"
  | "completed"
  | "failed";

export interface TaskRecord {
  id: string;

  tool: string;

  args: unknown;

  status: TaskStatus;

  result?: ToolExecutionResult;

  startedAt: number;

  finishedAt?: number;
}


export class TaskManager {
  private readonly tasks = new Map<string, TaskRecord>();

  // 已通知过主循环的任务 id——
  // 每条完成通知只进入消息历史一次
  private readonly notified = new Set<string>();

  private nextId = 1;

  constructor(
    private readonly registry: ToolRegistry,
  ) { }

  // 启动即返回 id：任务在后台异步执行，
  // 调用方（模型）不用等它结束
  start(tool: string, args: unknown): string {
    const id = `task-${this.nextId++}`;

    const record: TaskRecord = {
      id,
      tool,
      args,
      status: "running",
      startedAt: Date.now(),
    };

    this.tasks.set(id, record);

    // 每个后台任务用独立的 ToolContext（和第九章子代理同一个先例）。
    // 这既让任务之间互不可见，也避免了后台任务与前台
    // 并发写同一个 notes / todos 的竞态。
    const context: ToolContext = {
      notes: new Map<string, string>(),
      todos: [],
      loadedSkills: new Set<string>(),
    };

    this.registry
      .execute(tool, args, context)
      .then((result) => {
        record.status = result.success ? "completed" : "failed";
        record.result = result;
        record.finishedAt = Date.now();
      })
      .catch((error: unknown) => {
        // registry.execute 本身已经捕获工具内部的异常，
        // 这里的 catch 只是防御性兜底
        record.status = "failed";
        record.result = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
        record.finishedAt = Date.now();
      });

    return id;
  }

  get(id: string): TaskRecord | undefined {
    return this.tasks.get(id);
  }

  list(): TaskRecord[] {
    return [...this.tasks.values()];
  }

  // 主循环每步调用一次：
  // 把"已完成但还没通知过"的任务取出来，通知注入消息历史。
  // 取过的任务被标记，不会重复通知。
  drainFinished(): TaskRecord[] {
    const finished: TaskRecord[] = [];

    for (const task of this.tasks.values()) {
      if (
        task.status !== "running" &&
        !this.notified.has(task.id)
      ) {
        this.notified.add(task.id);
        finished.push(task);
      }
    }

    return finished;
  }
}


type RunInBackgroundArgs = {
  tool?: string;
  args?: unknown;
};

// run_in_background 本身定级 safe，但它是一个"代执行"工具——
// 真正的风险检查发生在它要启动的那个工具上：
// 只有 safe 工具可以进后台，因为后台没有审批的机会。
export function createRunInBackgroundTool(
  tasks: TaskManager,
  policy: PermissionPolicy,
): Tool {
  return {
    definition: {
      type: "function",

      function: {
        name: "run_in_background",

        description: [
          "Start a tool call in the background instead of waiting for it.",
          "Returns a task id IMMEDIATELY; the task runs in parallel.",
          "When the task finishes, its result arrives automatically",
          "as a notification — keep working on other things meanwhile.",
          "Use check_task with the task id to poll a task that has",
          "not reported back yet.",
          "Only tools rated 'safe' can run in the background.",
        ].join(" "),

        parameters: {
          type: "object",

          properties: {
            tool: {
              type: "string",
              description: "Name of the tool to run in the background.",
            },

            args: {
              type: "object",
              description: "Arguments for that tool, as a JSON object.",
            },
          },

          required: ["tool", "args"],

          additionalProperties: false,
        },
      },
    },

    execute(args) {
      const { tool, args: toolArgs } = args as RunInBackgroundArgs;

      if (!tool) {
        throw new Error("tool is required");
      }

      if (tool === "run_in_background") {
        throw new Error(
          "nesting background tasks is not supported",
        );
      }

      // 后台执行没有经过人工审批的机会——人不一定在终端前。
      // 所以后台是 safe 工具的专属通道：
      // sensitive / dangerous 工具只能在前台调用，走第四章的审批。
      if (riskLevelOf(policy, tool) !== "safe") {
        throw new Error(
          `Tool '${tool}' is not rated 'safe' and cannot run in the background. ` +
          `Call it directly so it can go through approval.`,
        );
      }

      const id = tasks.start(tool, toolArgs);

      return {
        task_id: id,
        status: "running" as TaskStatus,
      };
    },
  };
}


type CheckTaskArgs = {
  task_id?: string;
};

export function createCheckTaskTool(
  tasks: TaskManager,
): Tool {
  return {
    definition: {
      type: "function",

      function: {
        name: "check_task",

        description:
          "Check the status and result of a background task by its id. " +
          "Prefer waiting for the automatic notification over polling.",

        parameters: {
          type: "object",

          properties: {
            task_id: {
              type: "string",
              description: "The task id returned by run_in_background.",
            },
          },

          required: ["task_id"],

          additionalProperties: false,
        },
      },
    },

    execute(args) {
      const { task_id } = args as CheckTaskArgs;

      const task = task_id ? tasks.get(task_id) : undefined;

      if (!task) {
        throw new Error(`Unknown task: ${task_id}`);
      }

      return task;
    },
  };
}


export function createListTasksTool(
  tasks: TaskManager,
): Tool {
  return {
    definition: {
      type: "function",

      function: {
        name: "list_tasks",

        description:
          "List all background tasks with their ids, tools and statuses.",

        parameters: {
          type: "object",

          properties: {},

          additionalProperties: false,
        },
      },
    },

    execute() {
      return tasks.list().map((task) => ({
        id: task.id,
        tool: task.tool,
        status: task.status,
      }));
    },
  };
}
