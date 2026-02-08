/**
 * WebSocket Authentication Module
 * Uses HMAC-SHA256 tokens for agent authentication
 */
import { config } from "../config";
import { createHmac, timingSafeEqual } from "crypto";

const AUTH_SECRET = process.env["WS_AUTH_SECRET"];
if (!AUTH_SECRET) {
  throw new Error("WS_AUTH_SECRET environment variable is required for secure authentication");
}
const TOKEN_TTL_MS = 3600000; // 1 hour

// Shared validation patterns for consistency
export const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
export const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

interface TokenPayload {
  agent_id: string;
  session_id?: string;
  issued_at: number;
  expires_at: number;
}

/**
 * Validate agent_id format
 */
export function isValidAgentId(agentId: string | undefined | null): boolean {
  return !!agentId && AGENT_ID_PATTERN.test(agentId);
}

/**
 * Validate session_id format
 */
export function isValidSessionId(sessionId: string | undefined | null): boolean {
  return !!sessionId && SESSION_ID_PATTERN.test(sessionId);
}

/**
 * Generate an auth token for an agent
 */
export function generateToken(agentId: string, sessionId?: string): string {
  // Validate agent_id format (alphanumeric, hyphens, underscores, 1-64 chars)
  if (!isValidAgentId(agentId)) {
    throw new Error("Invalid agent_id format");
  }
  
  // Validate session_id format if provided
  if (sessionId && !isValidSessionId(sessionId)) {
    throw new Error("Invalid session_id format");
  }
  
  const payload: TokenPayload = {
    agent_id: agentId,
    session_id: sessionId,
    issued_at: Date.now(),
    expires_at: Date.now() + TOKEN_TTL_MS,
  };
  const data = JSON.stringify(payload);
  // Use proper HMAC instead of string concatenation
  const signature = createHmac("sha256", AUTH_SECRET)
    .update(data)
    .digest("hex");
  // Token format: base64(payload).signature
  const encoded = Buffer.from(data).toString("base64url");
  return `${encoded}.${signature}`;
}

/**
 * Validate an auth token
 */
export function validateToken(token: string): TokenPayload | null {
  try {
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature) return null;

    const data = Buffer.from(encoded, "base64url").toString();
    // Use proper HMAC instead of string concatenation
    const expectedSig = createHmac("sha256", AUTH_SECRET)
      .update(data)
      .digest("hex");

    // Use constant-time comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expectedSig, "hex");
    
    if (sigBuffer.length !== expectedBuffer.length) return null;
    if (!timingSafeEqual(sigBuffer, expectedBuffer)) return null;

    const payload: TokenPayload = JSON.parse(data);
    if (payload.expires_at < Date.now()) return null;

    // Validate agent_id format
    if (!isValidAgentId(payload.agent_id)) {
      return null;
    }
    
    // Validate session_id format if present
    if (payload.session_id && !isValidSessionId(payload.session_id)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Generate a token for hook scripts (simpler, longer-lived)
 */
export function generateHookToken(sessionId: string): string {
  return generateToken("hook-client", sessionId);
}
