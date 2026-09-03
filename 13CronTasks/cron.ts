import type {
  Tool,
} from "./tool.ts";


// ---------- cron 表达式解析 ----------
//
// 标准 5 字段：minute hour day-of-month month day-of-week
// 每个字段支持：*（任意）、*/n（每 n）、a（单值）、a-b（区间）、
// a-b/n（区间带步长）、以及逗号列表（如 1,15,30）。
// day-of-week：0 = 周日，6 = 周六。

// null 表示通配（*），否则是该字段允许值的集合
type CronField = Set<number> | null;

function parseField(
  field: string,
  min: number,
  max: number,
  name: string,
): CronField {
  if (field === "*") {
    return null;
  }

  const values = new Set<number>();

  for (const part of field.split(",")) {
    const [range, stepStr] = part.split("/");

    const step = stepStr === undefined ? 1 : Number(stepStr);

    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`invalid step in ${name}: ${part}`);
    }

    let lo: number;
    let hi: number;

    if (range === "*" || range === "") {
      lo = min;
      hi = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-").map(Number);
      lo = a;
      hi = b;
    } else {
      lo = Number(range);
      // "5/10" 的意思是 5, 15, 25, ... 直到字段上限
      hi = stepStr === undefined ? lo : max;
    }

    if (
      !Number.isInteger(lo) ||
      !Number.isInteger(hi) ||
      lo < min ||
      hi > max ||
      lo > hi
    ) {
      throw new Error(`invalid ${name} field: ${part}`);
    }

    for (let value = lo; value <= hi; value += step) {
      values.add(value);
    }
  }

  return values;
}

interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

export function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);

  if (fields.length !== 5) {
    throw new Error(
      `cron expression must have 5 fields, got ${fields.length}: "${expression}"`,
    );
  }

  return {
    minute: parseField(fields[0], 0, 59, "minute"),
    hour: parseField(fields[1], 0, 23, "hour"),
    dayOfMonth: parseField(fields[2], 1, 31, "day-of-month"),
    month: parseField(fields[3], 1, 12, "month"),
    dayOfWeek: parseField(fields[4], 0, 6, "day-of-week"),
  };
}

function fieldMatches(values: CronField, value: number): boolean {
  return values === null || values.has(value);
}

// 求 after 之后的下一个触发时间：从下一分钟开始逐分钟扫描。
// 简单粗暴但正确——上限一年，一年内找不到触发时间的表达式
//（如 "0 0 31 2 *"，2 月 31 日）在创建时就会被拒绝。
export function nextFireAfter(
  expression: string,
  after: Date,
): Date {
  const parsed = parseCron(expression);

  const candidate = new Date(after);

  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limitMinutes = 366 * 24 * 60;

  for (let i = 0; i < limitMinutes; i++) {
    if (
      fieldMatches(parsed.minute, candidate.getMinutes()) &&
      fieldMatches(parsed.hour, candidate.getHours()) &&
      fieldMatches(parsed.dayOfMonth, candidate.getDate()) &&
      fieldMatches(parsed.month, candidate.getMonth() + 1) &&
      fieldMatches(parsed.dayOfWeek, candidate.getDay())
    ) {
      return new Date(candidate);
    }

    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new Error(
    `cron expression has no fire time within one year: "${expression}"`,
  );
}


// ---------- 调度器 ----------

export interface CronJob {
  id: string;

  cron: string;

  prompt: string;

  recurring: boolean;

  createdAt: number;

  nextFireAt: number;

  fireCount: number;
}

export class CronManager {
  private readonly jobs = new Map<string, CronJob>();

  // 到点任务先入队，串行执行——
  // 一次 run 还没跑完又到点了，触发的任务排队而不是并发开跑
  private readonly queue: CronJob[] = [];

  private nextId = 1;

  private timer: NodeJS.Timeout | undefined;

  private firing = false;

  constructor(
    private readonly onFire: (job: CronJob) => Promise<void>,
    private readonly tickMs: number = 1_000,
  ) { }

  add(
    cron: string,
    prompt: string,
    recurring: boolean,
  ): CronJob {
    const job: CronJob = {
      id: `cron-${this.nextId++}`,
      cron,
      prompt,
      recurring,
      createdAt: Date.now(),
      // 非法表达式在这里就会抛出来——创建即校验
      nextFireAt: nextFireAfter(cron, new Date()).getTime(),
      fireCount: 0,
    };

    this.jobs.set(job.id, job);

    return job;
  }

  remove(id: string): boolean {
    return this.jobs.delete(id);
  }

  get(id: string): CronJob | undefined {
    return this.jobs.get(id);
  }

  list(): CronJob[] {
    return [...this.jobs.values()];
  }

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async tick(): Promise<void> {
    const now = Date.now();

    for (const job of this.jobs.values()) {
      if (now >= job.nextFireAt) {
        job.fireCount++;

        if (job.recurring) {
          job.nextFireAt = nextFireAfter(
            job.cron,
            new Date(now),
          ).getTime();
        } else {
          // 一次性任务：触发即自动删除
          this.jobs.delete(job.id);
        }

        this.queue.push(job);
      }
    }

    await this.drain();
  }

  private async drain(): Promise<void> {
    if (this.firing) {
      return;
    }

    this.firing = true;

    try {
      let job: CronJob | undefined;

      while ((job = this.queue.shift()) !== undefined) {
        await this.onFire(job);
      }
    } finally {
      this.firing = false;
    }
  }
}


// ---------- 工具 ----------

type CreateCronArgs = {
  cron?: string;
  prompt?: string;
  recurring?: boolean;
};

export function createCronTool(
  manager: CronManager,
): Tool {
  return {
    definition: {
      type: "function",

      function: {
        name: "create_cron",

        description: [
          "Schedule a prompt to run in the future, like a cron job.",
          "Each fire starts a FRESH run that cannot see this",
          "conversation — write the prompt so it is fully",
          "self-contained.",
          "",
          "The cron expression has 5 fields:",
          "minute hour day-of-month month day-of-week.",
          "Examples:",
          "- '*/5 * * * *'  every 5 minutes",
          "- '30 9 * * *'   every day at 09:30",
          "- '0 9 * * 1-5'  weekdays at 09:00",
          "",
          "Set recurring=false for a one-shot reminder:",
          "it fires once and deletes itself.",
        ].join(" "),

        parameters: {
          type: "object",

          properties: {
            cron: {
              type: "string",
              description: "5-field cron expression.",
            },

            prompt: {
              type: "string",
              description:
                "The self-contained prompt to run at each fire time.",
            },

            recurring: {
              type: "boolean",
              description:
                "true (default) fires on every match; " +
                "false fires once and auto-deletes.",
            },
          },

          required: ["cron", "prompt"],

          additionalProperties: false,
        },
      },
    },

    execute(args) {
      const { cron, prompt, recurring } = args as CreateCronArgs;

      if (!cron) {
        throw new Error("cron is required");
      }

      if (!prompt) {
        throw new Error("prompt is required");
      }

      const job = manager.add(
        cron,
        prompt,
        recurring ?? true,
      );

      return {
        id: job.id,
        cron: job.cron,
        recurring: job.recurring,
        next_fire_at: new Date(job.nextFireAt).toLocaleString(
          "zh-CN",
          { timeZone: "Asia/Shanghai" },
        ),
      };
    },
  };
}


export function createListCronsTool(
  manager: CronManager,
): Tool {
  return {
    definition: {
      type: "function",

      function: {
        name: "list_crons",

        description:
          "List all scheduled cron tasks with their ids, " +
          "expressions, prompts and next fire times.",

        parameters: {
          type: "object",

          properties: {},

          additionalProperties: false,
        },
      },
    },

    execute() {
      return manager.list().map((job) => ({
        id: job.id,
        cron: job.cron,
        prompt: job.prompt,
        recurring: job.recurring,
        fire_count: job.fireCount,
        next_fire_at: new Date(job.nextFireAt).toLocaleString(
          "zh-CN",
          { timeZone: "Asia/Shanghai" },
        ),
      }));
    },
  };
}


type DeleteCronArgs = {
  id?: string;
};

export function createDeleteCronTool(
  manager: CronManager,
): Tool {
  return {
    definition: {
      type: "function",

      function: {
        name: "delete_cron",

        description:
          "Cancel a scheduled cron task by its id. " +
          "This cannot be undone — the task must be " +
          "re-created to schedule it again.",

        parameters: {
          type: "object",

          properties: {
            id: {
              type: "string",
              description: "The cron task id returned by create_cron.",
            },
          },

          required: ["id"],

          additionalProperties: false,
        },
      },
    },

    execute(args) {
      const { id } = args as DeleteCronArgs;

      if (!id || !manager.remove(id)) {
        throw new Error(`Unknown cron task: ${id}`);
      }

      return { deleted: id };
    },
  };
}
