import type {
  AgentHooks
} from "./hooks.ts";

export function createLoggerHook(
  prefix: string = ""
): AgentHooks {
  return {
    onStepStart(step) {
      console.log(
        `\n===============${prefix}Agent Step ${step} ==============`,
      );
    },

    onToolCall(name, args) {
      console.log(`\n${prefix}Action:`, name);

      console.log(
        `${prefix}Action Input:`,
        JSON.stringify(args),
      );
    },

    onToolResult(_name, _args, result) {
      console.log(`${prefix}Observation:`, result);
    },

    onCompact(beforeTokens, afterTokens, summary) {
      console.log(
        `\n${prefix}Context compacted: ~${beforeTokens} -> ~${afterTokens} tokens (est.)`,
      );

      console.log(`${prefix}Summary:`, summary);
    },

    onRunEnd() {
      console.log(`\n${prefix}Agent returned Final Answer`);
    },
  };
}

export const loggerHook = createLoggerHook();
