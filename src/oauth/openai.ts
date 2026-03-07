export interface OpenAIOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // unix seconds
}

interface OpenAIOAuthTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
}

export const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_OAUTH_REDIRECT_URI = "http://localhost:1455/auth/callback";
export const OPENAI_OAUTH_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
export const OPENAI_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";

export function buildOpenAIOAuthAuthorizeUrl(
  state: string,
  codeChallenge: string
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: OPENAI_CODEX_CLIENT_ID,
    redirect_uri: OPENAI_OAUTH_REDIRECT_URI,
    scope: "openid profile email offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
  });
  return `${OPENAI_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeOpenAIOAuthCode(
  code: string,
  codeVerifier: string
): Promise<OpenAIOAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: OPENAI_CODEX_CLIENT_ID,
    code,
    redirect_uri: OPENAI_OAUTH_REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  return postTokenForm(body);
}

export async function refreshOpenAIAccessToken(
  refreshToken: string
): Promise<OpenAIOAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: OPENAI_CODEX_CLIENT_ID,
    refresh_token: refreshToken,
  });

  return postTokenForm(body);
}

async function postTokenForm(body: URLSearchParams): Promise<OpenAIOAuthTokens> {
  const res = await fetch(OPENAI_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const json = (await res.json()) as OpenAIOAuthTokenResponse;
  if (!res.ok) {
    const desc =
      typeof json.error_description === "string"
        ? json.error_description
        : `HTTP ${res.status}`;
    throw new Error(desc);
  }

  const accessToken = asNonEmptyString(json.access_token);
  if (!accessToken) {
    throw new Error("No access_token in OAuth response");
  }

  const refreshToken = asNonEmptyString(json.refresh_token);
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : null;
  const expiresAt =
    typeof expiresIn === "number" && Number.isFinite(expiresIn)
      ? Math.floor(Date.now() / 1000) + Math.max(0, Math.floor(expiresIn))
      : undefined;

  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(typeof expiresAt === "number" ? { expiresAt } : {}),
  };
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
