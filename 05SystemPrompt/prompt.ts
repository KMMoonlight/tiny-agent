export type PromptToolInfo = {
  name: string;
  description: string;
};

export type PromptContext = {
  now: Date;

  tools: PromptToolInfo[];
};

export type PromptSection = {
  heading: string;

  body: string | ((context: PromptContext) => string);
};

export function buildSystemPrompt(
  sections: PromptSection[],
  context: PromptContext,
): string {
  return sections
    .map((section) => {
      const body = typeof section.body === "function"
        ? section.body(context)
        : section.body;

      return `## ${section.heading}\n\n${body.trim()}`;
    })
    .join("\n\n");
}
