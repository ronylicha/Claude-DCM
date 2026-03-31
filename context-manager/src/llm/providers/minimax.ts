import { BaseLLMProvider } from "../base-provider";
import type { ChatCompletionRequest, LLMProviderRow } from "../types";

export class MiniMaxProvider extends BaseLLMProvider {
  readonly key = "minimax";
  readonly name = "MiniMax";

  constructor(config: LLMProviderRow) {
    super(config);
  }

  protected override buildBody(request: ChatCompletionRequest): Record<string, unknown> {
    const body = super.buildBody(request);
    // MiniMax recommends temperature=1
    body["temperature"] = 1;
    return body;
  }

  /** MiniMax wraps thinking in <think> tags — extract the actual response */
  protected override extractContent(data: Record<string, unknown>): string {
    const raw = super.extractContent(data);
    // Strip <think>...</think> block if present
    const cleaned = raw.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
    return cleaned || raw;
  }
}
