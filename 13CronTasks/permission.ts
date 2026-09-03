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

    // 后台任务三件套本身是 safe 的——
    // run_in_background 内部会再查一次被启动工具的等级，
    // 只有 safe 工具能进后台
    run_in_background: "safe",
    check_task: "safe",
    list_tasks: "safe",

    // 定时任务：创建和查看是无害的；
    // 删除是不可逆的取消，走人工审批
    create_cron: "safe",
    list_crons: "safe",
    delete_cron: "sensitive",

    save_note: "sensitive",
    // 记忆会污染未来的每一次运行，
    // 写入必须经过人工审批
    save_memory: "sensitive",
    delete_note: "dangerous",
  },
};
