import type {
  AgentHooks
} from "./hooks.ts";

const RESERVED_NOTE_KEY_PREFIX = "sys_";

export const guardHook: AgentHooks = {
  onToolCall(name, args) {
    if (name !== "save_note") {
      return;
    }

    const { key } = args as {
      key?: unknown;
    };

    if (
      typeof key === "string" &&
      key.startsWith(RESERVED_NOTE_KEY_PREFIX)
    ) {
      return {
        action: "block",
        reason: `Policy violation: note keys starting with "${RESERVED_NOTE_KEY_PREFIX}" are reserved for the system and cannot be written (got "${key}").`,
      };
    }
  },
};
