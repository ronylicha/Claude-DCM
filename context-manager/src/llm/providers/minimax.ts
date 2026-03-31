import { BaseLLMProvider } from "../base-provider";
import type { LLMProviderRow } from "../types";

export class MiniMaxProvider extends BaseLLMProvider {
  readonly key = "minimax";
  readonly name = "MiniMax";

  constructor(config: LLMProviderRow) {
    super(config);
  }
}
