import type {
  Tool
} from "./tool.ts";

type CalculatorArgs = {
  a: number;

  operation:
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "power";

  b: number;
};

export const calculatorTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "calculator",
      description: "Perform mathematical calculations. Use this tool whenever exact arithmetic is needed.",

      parameters: {
        type: "object",
        properties: {
          a: {
            type: "number",
            description: "First number"
          },
          operation: {
            type: "string",
            enum: [
              "add",
              "subtract",
              "multiply",
              "divide",
              "power"
            ],
          },
          b: {
            type: "number",
            description: "Second number"
          },
        },
        required: [
          "a",
          "operation",
          "b",
        ],
        additionalProperties: false
      },
    }
  },

  execute(args) {
    const {
      a,
      operation,
      b,
    } = args as CalculatorArgs;

    if (
      typeof a !== "number" ||
      typeof b !== "number"
    ) {
      throw new Error(
        "a and b must be numbers",
      );
    }

    switch (operation) {
      case "add":
        return a + b;

      case "subtract":
        return a - b;

      case "multiply":
        return a * b;

      case "divide":
        if (b === 0) {
          throw new Error(
            "division by zero",
          );
        }

        return a / b;

      case "power":
        return a ** b;

      default:
        throw new Error(
          `Unknown operation: ${operation}`,
        );
    }
  }
}
