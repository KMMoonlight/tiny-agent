import {
  readdirSync,
  readFileSync,
} from "node:fs";

import {
  join,
} from "node:path";


export type SkillMeta = {
  name: string;

  description: string;
};

export type Skill = SkillMeta & {
  body: string;
};


function parseSkillFile(content: string): Skill {
  const match = content.match(
    /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/,
  );

  if (!match) {
    throw new Error(
      "SKILL.md must start with a --- frontmatter block",
    );
  }

  const [, frontmatter, body] = match;

  const fields: Record<string, string> = {};

  for (const line of frontmatter.split("\n")) {
    const separator = line.indexOf(":");

    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();

    fields[key] = value;
  }

  if (!fields.name || !fields.description) {
    throw new Error(
      "SKILL.md frontmatter requires name and description",
    );
  }

  return {
    name: fields.name,
    description: fields.description,
    body: body.trim(),
  };
}


export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  loadDir(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const path = join(dir, entry.name, "SKILL.md");

      let skill: Skill;

      try {
        skill = parseSkillFile(readFileSync(path, "utf8"));
      } catch (error) {
        throw new Error(
          `Failed to load skill at ${path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (this.skills.has(skill.name)) {
        throw new Error(`Skill already exists: ${skill.name}`);
      }

      this.skills.set(skill.name, skill);
    }
  }

  list(): SkillMeta[] {
    return [...this.skills.values()].map(
      ({ name, description }) => ({ name, description }),
    );
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }
}
