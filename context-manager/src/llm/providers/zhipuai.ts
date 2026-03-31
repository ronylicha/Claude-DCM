import { BaseLLMProvider } from "../base-provider";
import type { ChatCompletionRequest, LLMProviderRow } from "../types";

export class ZhipuAIProvider extends BaseLLMProvider {
  readonly key = "zhipuai";
  readonly name = "ZhipuAI (GLM)";

  constructor(config: LLMProviderRow) {
    super(config);
  }

  protected override buildHeaders(): Record<string, string> {
    return {
      ...super.buildHeaders(),
      "Accept-Language": "en-US,en",
    };
  }

  protected override buildBody(request: ChatCompletionRequest): Record<string, unknown> {
    const body = super.buildBody(request);
    // ZhipuAI uses max_tokens not max_completion_tokens
    return body;
  }
}
