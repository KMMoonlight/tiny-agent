import readline from "node:readline";

import type {
  AgentHooks,
} from "./hooks.ts";

import {
  riskLevelOf,
  type PermissionPolicy,
} from "./permission.ts";

export function createApprovalHook(
  policy: PermissionPolicy,
): AgentHooks {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const sessionAllowed = new Set<string>();

  let closed = false;

  let pendingResolve:
    | ((answer: string) => void)
    | null = null;

  rl.on("close", () => {
    closed = true;

    pendingResolve?.("");
    pendingResolve = null;
  });

  function ask(
    prompt: string,
  ): Promise<string> {
    if (closed) {
      return Promise.resolve("");
    }

    return new Promise(
      resolve => {
        pendingResolve = resolve;

        rl.question(
          prompt,
          answer => {
            pendingResolve = null;
            resolve(answer.trim().toLowerCase());
          },
        );
      }
    );
  }

  return {
    async onToolCall(name, args) {
      const level = riskLevelOf(policy, name);

      if (level === "safe") {
        return;
      }

      if (level === "dangerous") {
        console.log(
          `\n[permission] DENIED without approval: "${name}" is dangerous`
        );

        return {
          action: "block",
          reason: `Permission denied: tool "${name}" is classified as dangerous and is not allowed to run.`,
        };
      }

      if (sessionAllowed.has(name)) {
        return;
      }

      console.log("\n[permission] Approval required");
      console.log("  Tool:", name);
      console.log("  Args:", JSON.stringify(args));

      const answer = await ask(
        "  Approve this call? [y]es / [n]o / [a]lways: "
      );

      if (answer === "a" || answer === "always") {
        sessionAllowed.add(name);

        console.log(`[permission] "${name}" allowed for the rest of this session`);

        return;
      }

      if (answer === "y" || answer === "yes") {
        return;
      }

      if (closed) {
        console.log(
          `[permission] DENIED without approval: no interactive terminal available for "${name}"`
        );

        return {
          action: "block",
          reason: `Permission denied: tool "${name}" requires human approval, but no interactive terminal is available to grant it.`,
        };
      }

      return {
        action: "block",
        reason: `Permission denied by the human operator for tool "${name}".`,
      };
    },

    onRunEnd() {
      rl.close();
    },
  };
}
