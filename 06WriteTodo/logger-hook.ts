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

  onRunEnd() {
    console.log("\nAgent returned Final Answer");
  },
};
