import type {
  Tool,
} from "./tool.ts";

import type {
  SkillRegistry,
} from "./skill.ts";


export function createLoadSkillTool(
  skills: SkillRegistry,
): Tool {
  return {
    definition: {
      type: "function",
      function: {
        name: "load_skill",
        description: "Load the full instructions of a skill by name. Call this BEFORE starting a task that matches the skill's description, then follow the returned instructions.",

        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The skill name, as listed in the Skills section of the system prompt.",
            },
          },
          required: [
            "name",
          ],
          additionalProperties: false,
        },
      },
    },

    execute(args, context) {
      const { name } = args as { name?: unknown };

      if (typeof name !== "string" || name.trim() === "") {
        throw new Error("name must be a non-empty string");
      }

      if (context.loadedSkills.has(name)) {
        return `Skill "${name}" is already loaded. Its instructions are in the conversation history above.`;
      }

      const skill = skills.get(name);

      if (!skill) {
        const available = skills.list()
          .map((meta) => meta.name)
          .join(", ");

        throw new Error(
          `Unknown skill: ${name}. Available skills: ${available}`,
        );
      }

      context.loadedSkills.add(name);

      return [
        `Skill "${skill.name}" loaded. Follow these instructions:`,
        "",
        skill.body,
      ].join("\n");
    },
  };
}
