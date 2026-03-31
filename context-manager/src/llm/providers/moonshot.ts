import { BaseLLMProvider } from "../base-provider";
import type { ChatCompletionRequest, LLMProviderRow } from "../types";

export class MoonshotProvider extends BaseLLMProvider {
  readonly key = "moonshot";
  readonly name = "Moonshot (Kimi)";

  constructor(config: LLMProviderRow) {
    super(config);
  }

  protected override buildBody(request: ChatCompletionRequest): Record<string, unknown> {
    const body = super.buildBody(request);
    // Kimi uses max_completion_tokens instead of max_tokens
    if (body["max_tokens"]) {
      body["max_completion_tokens"] = body["max_tokens"];
      delete body["max_tokens"];
    }
    return body;
  }
}
