/**
 * WebSocket Authentication Module
 * Uses HMAC-SHA256 tokens for agent authentication
 */
import { config } from "../config";

const AUTH_SECRET = process.env["WS_AUTH_SECRET"] || "dcm-dev-secret-change-me";
const TOKEN_TTL_MS = 3600000; // 1 hour

interface TokenPayload {
  agent_id: string;
  session_id?: string;
  issued_at: number;
  expires_at: number;
}

/**
 * Generate an auth token for an agent
 */
export function generateToken(agentId: string, sessionId?: string): string {
  const payload: TokenPayload = {
    agent_id: agentId,
    session_id: sessionId,
    issued_at: Date.now(),
    expires_at: Date.now() + TOKEN_TTL_MS,
  };
  const data = JSON.stringify(payload);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(AUTH_SECRET + data);
  const signature = hasher.digest("hex");
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
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(AUTH_SECRET + data);
    const expectedSig = hasher.digest("hex");

    if (signature !== expectedSig) return null;

    const payload: TokenPayload = JSON.parse(data);
    if (payload.expires_at < Date.now()) return null;

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
