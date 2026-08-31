import type {
  AgentHooks
} from "./hooks.ts";

export function createMetricsHook(): AgentHooks {
  let startedAt = 0;
  let toolCalls = 0;

  const perTool = new Map<string, number>();

  return {
    onRunStart() {
      startedAt = Date.now();
    },

    onToolCall(name) {
      toolCalls += 1;

      perTool.set(
        name,
        (perTool.get(name) ?? 0) + 1,
      );
    },

    onRunEnd(_answer, steps) {
      const durationMs = Date.now() - startedAt;

      console.log("\n================= METRICS ====================");

      console.log("Steps:", steps);

      console.log("Tool calls:", toolCalls);

      console.log(
        "Per tool:",
        Object.fromEntries(perTool.entries()),
      );

      console.log(`Duration: ${durationMs} ms`);
    },
  };
}
