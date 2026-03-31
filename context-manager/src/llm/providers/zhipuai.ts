import { BaseLLMProvider } from "../base-provider";
import type { ChatCompletionRequest, ChatCompletionResponse, LLMProviderRow } from "../types";

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

  /** GLM-5 models use reasoning by default — extract reasoning_content if content is empty */
  protected override extractContent(data: Record<string, unknown>): string {
    const choices = data["choices"] as Array<Record<string, unknown>> | undefined;
    const firstChoice = choices?.[0];
    const message = firstChoice?.["message"] as Record<string, unknown> | undefined;
    const content = String(message?.["content"] ?? "");
    if (content.trim()) return content;
    // Fallback to reasoning_content for thinking models
    const reasoning = String(message?.["reasoning_content"] ?? "");
    return reasoning || content;
  }
}
