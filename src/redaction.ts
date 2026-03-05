// List of keys that should be redacted in nested objects
export const SENSITIVE_KEYS = [
  "password",
  "token",
  "secret",
  "key",
  "mnemonic",
  "signer_uuid",
  "api_key",
  "auth",
  "credential",
];

// Mask patterns in strings (API keys, tokens, etc)
export const SENSITIVE_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g, // Anthropic/OpenAI keys
  /ghp_[a-zA-Z0-9]{36}/g, // GitHub tokens
  /neynar-[a-zA-Z0-9]+/g, // Neynar keys
  /0x[a-fA-F0-9]{64}/g, // Private keys (64 hex chars)
];

/**
 * Deep clone and redact sensitive fields/patterns.
 * - For objects: if key matches SENSITIVE_KEYS, replace value with "***"
 * - For strings: replace SENSITIVE_PATTERNS matches with first 4 chars + "***"
 * - Recurse into arrays and nested objects
 */
export function redact(obj: unknown): unknown {
  return redactValue(obj, false);
}

function redactValue(value: unknown, isSensitiveKey: boolean): unknown {
  if (value === null || value === undefined) return value;

  // If this value sits under a sensitive key, mask it entirely
  if (isSensitiveKey) {
    if (typeof value === "string") return "***";
    if (typeof value === "number" || typeof value === "boolean") return "***";
    // For objects/arrays under a sensitive key, still mask to "***"
    return "***";
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, false));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const keyIsSensitive = SENSITIVE_KEYS.some(
        (sk) => k.toLowerCase().includes(sk),
      );
      result[k] = redactValue(v, keyIsSensitive);
    }
    return result;
  }

  return value;
}

/**
 * Replace sensitive patterns in a string with the first 4 characters + "***".
 */
export function redactString(str: string): string {
  let result = str;
  for (const pattern of SENSITIVE_PATTERNS) {
    // Reset lastIndex since these are global regexes
    pattern.lastIndex = 0;
    result = result.replace(pattern, (match) => {
      const prefix = match.slice(0, 4);
      return `${prefix}***`;
    });
  }
  return result;
}
