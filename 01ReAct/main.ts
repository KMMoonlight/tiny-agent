import "dotenv/config";

import {
  createLLMClient,
} from "./llm.ts";

import {
  Agent,
} from "./agent.ts";

import {
  tools,
} from "./tools.ts";


async function main() {
  const llm = createLLMClient();

  const agent = new Agent(
    llm,
    tools,
  );

  const answer = await agent.run("计算 123 * 456, 然后再加100");

  console.log(
    "\n==============Final Answer========"
  );

  console.log(answer);
}

main().catch(console.error);
