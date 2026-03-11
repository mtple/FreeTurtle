/**
 * Alpha feature gate.
 *
 * Set FREETURTLE_ALPHA=true in .env to enable experimental features.
 */
export function isAlpha(): boolean {
  return process.env.FREETURTLE_ALPHA === "true";
}

export const ALPHA_REQUIRED_MSG =
  "This feature requires FREETURTLE_ALPHA=true in .env";
