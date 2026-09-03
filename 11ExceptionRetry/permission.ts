export type RiskLevel =
  | "safe"
  | "sensitive"
  | "dangerous";

export interface PermissionPolicy {
  defaultLevel: RiskLevel;

  tools: Record<string, RiskLevel>;
}

export function riskLevelOf(
  policy: PermissionPolicy,
  toolName: string,
): RiskLevel {
  return policy.tools[toolName] ?? policy.defaultLevel;
}

export const defaultPolicy: PermissionPolicy = {
  defaultLevel: "sensitive",

  tools: {
    calculator: "safe",
    text_stats: "safe",
    current_time: "safe",
    knowledge_search: "safe",
    list_notes: "safe",
    write_todo: "safe",
    load_skill: "safe",
    spawn_subagent: "safe",
    search_memory: "safe",

    save_note: "sensitive",
    // 记忆会污染未来的每一次运行，
    // 写入必须经过人工审批
    save_memory: "sensitive",
    delete_note: "dangerous",
  },
};
