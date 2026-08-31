import type {
  AgentHooks
} from "./hooks.ts";

export const loggerHook: AgentHooks = {
  onStepStart(step) {
    console.log(
      `\n===============Agent Step ${step} ==============`,
    );
  },

  onToolCall(name, args) {
    console.log("\nAction:", name);

    console.log(
      "Action Input:",
      JSON.stringify(args),
    );
  },

  onToolResult(_name, _args, result) {
    console.log("Observation:", result);
  },

  onCompact(beforeTokens, afterTokens, summary) {
    console.log(
      `\nContext compacted: ~${beforeTokens} -> ~${afterTokens} tokens (est.)`,
    );

    console.log("Summary:", summary);
  },

  onRunEnd() {
    console.log("\nAgent returned Final Answer");
  },
};
