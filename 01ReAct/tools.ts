import type {
  ToolDefinition
} from './llm.ts';


export type Tool = {
  definition: ToolDefinition;

  execute(
    args: unknown,
  ): unknown | Promise<unknown>;
}

type CalculatorArgs = {
  a: number;
  operator: "+" | "-" | "*" | "/";
  b: number;
};

const calculator: Tool = {
  definition: {
    type: "function",

    function: {
      name: "calculator",
      description: "Perform basic mathematical calculations",
      parameters: {
        type: "object",
        properties: {
          a: {
            type: "number",
          },
          operator: {
            type: "string",
            enum: [
              "+",
              "-",
              "*",
              "/",
            ],
          },
          b: {
            type: "number",
          },
        },

        required: [
          "a",
          "operator",
          "b",
        ],
        additionalProperties: false,
      },
    },
  },

  execute(args) {
    const {
      a,
      operator,
      b,
    } = args as CalculatorArgs;

    switch (operator) {
      case "+":
        return a + b;
      case "-":
        return a - b;
      case "*":
        return a * b;
      case "/":
        if (b === 0) {
          throw new Error(
            "division by zero",
          );
        }
        return a / b;
    }
  },
};

export const tools = new Map<string, Tool>();

tools.set(
  calculator.definition.function.name,
  calculator,
);
