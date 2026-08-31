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

    save_note: "sensitive",
    delete_note: "dangerous",
  },
};
