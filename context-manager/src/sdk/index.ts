/**
 * DCM Client SDK
 * TypeScript client for Distributed Context Manager
 * Provides both REST API and WebSocket real-time communication
 */

export { DCMClient } from "./client";
export { DCMWebSocket } from "./ws-client";
export type {
  DCMConfig,
  ActionInput,
  ToolSuggestion,
  SubtaskInput,
  MessageInput,
  SessionInput,
} from "./types";
