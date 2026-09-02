import type {
  Tool,
} from "./tool.ts";


type CurrentTimeArgs = { timezone?: string };

export const currentTimeTool: Tool = {
  definition: {
    type: "function",

    function: {
      name: "current_time",
      description: "Get the current date and time. Can optionally format the time for an IANA timezone such as Asia/Tokyo.",
      parameters: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description: "Optional IANA timezone, for example Asia/Tokyo or America/New_York",
          }
        },
        additionalProperties: false
      }
    }
  },

  execute(args) {
    const { timezone } = args as CurrentTimeArgs;

    const now = new Date();

    if (!timezone) {
      return {
        iso: now.toISOString(),
        timestamp: now.getTime()
      };
    }

    try {
      return {
        timezone,
        formatted: new Intl.DateTimeFormat("zh-CN", {
          dateStyle: "full",
          timeStyle: "long",
          timeZone: timezone,
        }).format(now),
        iso: now.toISOString(),
      };
    } catch {
      throw new Error(
        `Invalid timezone: ${timezone}`
      );
    }
  }
}
