import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ConnectedAccount, InboxMessage } from "@/lib/types";

type GoogleTokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type StoredGoogleToken = GoogleTokenResponse & {
  created_at: string;
};

type GmailMessageListResponse = {
  messages?: Array<{ id: string }>;
};

type GmailMessageResponse = {
  id: string;
  payload?: {
    body?: { data?: string };
    headers?: Array<{ name: string; value: string }>;
    parts?: Array<{
      body?: { data?: string };
      mimeType?: string;
      parts?: Array<{ body?: { data?: string }; mimeType?: string }>;
    }>;
  };
  snippet?: string;
};

const gmailScope = "https://www.googleapis.com/auth/gmail.readonly";
const authBaseUrl = "https://accounts.google.com/o/oauth2/v2/auth";
const tokenUrl = "https://oauth2.googleapis.com/token";
const gmailApiBaseUrl = "https://gmail.googleapis.com/gmail/v1/users/me";
const tokenStorePath = join(process.cwd(), "data", "oauth-tokens.json");

export function isRealGmailOAuthConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REDIRECT_URI,
  );
}

export function createGmailAuthorizationUrl(businessId: string) {
  const state = createOAuthState(businessId);
  const url = new URL(authBaseUrl);

  url.searchParams.set("client_id", requiredEnv("GOOGLE_CLIENT_ID"));
  url.searchParams.set("redirect_uri", requiredEnv("GOOGLE_REDIRECT_URI"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", gmailScope);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);

  return url.toString();
}

export async function exchangeGmailOAuthCode(code: string) {
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      code,
      grant_type: "authorization_code",
      redirect_uri: requiredEnv("GOOGLE_REDIRECT_URI"),
    }),
  });

  if (!response.ok) {
    throw new Error(`Google token exchange failed with ${response.status}.`);
  }

  return (await response.json()) as GoogleTokenResponse;
}

export async function storeGmailToken(
  businessId: string,
  token: GoogleTokenResponse,
) {
  const tokens = await readTokenStore();
  tokens[gmailTokenKey(businessId)] = encryptToken({
    ...token,
    created_at: new Date().toISOString(),
  });
  await writeTokenStore(tokens);
}

export async function readGmailToken(businessId: string) {
  const tokens = await readTokenStore();
  const encrypted = tokens[gmailTokenKey(businessId)];

  if (!encrypted) {
    return null;
  }

  return decryptToken(encrypted);
}

export function validateOAuthState(state: string, businessId: string) {
  const [payload, signature] = state.split(".");

  if (!payload || !signature || signState(payload) !== signature) {
    return false;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      businessId?: string;
      createdAt?: string;
    };
    const createdAt = parsed.createdAt ? Date.parse(parsed.createdAt) : 0;
    const ageMs = Date.now() - createdAt;

    return parsed.businessId === businessId && ageMs >= 0 && ageMs < 10 * 60 * 1000;
  } catch {
    return false;
  }
}

export function createMockGmailAccount(now = new Date()): ConnectedAccount {
  return {
    id: "gmail-primary",
    provider: "Gmail",
    status: "connected",
    accountLabel: process.env.OPSPILOT_GMAIL_ACCOUNT ?? "ops@brightops.example",
    connectedAt: now.toISOString(),
    message: "Gmail mock connector is ready to import business messages.",
  };
}

export function createRealGmailAccount(token: GoogleTokenResponse, now = new Date()): ConnectedAccount {
  return {
    id: "gmail-primary",
    provider: "Gmail",
    status: "connected",
    accountLabel: "Google Gmail connected",
    connectedAt: now.toISOString(),
    message: token.refresh_token
      ? "Gmail OAuth connected with read-only import access."
      : "Gmail OAuth connected. Reconnect if imports stop after the access token expires.",
  };
}

export function createImportedGmailMessages(now = new Date()): InboxMessage[] {
  const stamp = now.getTime();

  return [
    {
      id: `gmail-import-${stamp}-lead`,
      from: "procurement@urbanstay.example",
      subject: "Monthly cleaning contract request",
      receivedAt: "Imported now",
      preview:
        "UrbanStay wants a monthly cleaning quote for three apartments and asked for pricing this week.",
      body:
        "Customer: UrbanStay Apartments. We need monthly cleaning for three serviced apartments. Budget is £2,750 and we need pricing this week.",
      status: "unscanned",
      estimatedValue: 2750,
    },
    {
      id: `gmail-import-${stamp}-invoice`,
      from: "finance@northline.example",
      subject: "Invoice copy needed",
      receivedAt: "Imported now",
      preview:
        "Northline says invoice NL-338 for £1,180 is unpaid because the payment link is missing.",
      body:
        "Customer: Northline Offices. Invoice NL-338 for £1,180 is unpaid because the payment link is missing. Please resend today.",
      status: "unscanned",
      estimatedValue: 1180,
    },
    {
      id: `gmail-import-${stamp}-complaint`,
      from: "hello@mapleclinic.example",
      subject: "Cleaning issue in reception",
      receivedAt: "Imported now",
      preview:
        "Maple Clinic complained that reception was missed twice and may pause the contract.",
      body:
        "Customer: Maple Clinic. Reception was missed twice this month. If this continues we may pause the £1,600 monthly cleaning contract.",
      status: "unscanned",
      estimatedValue: 1600,
    },
  ];
}

export function markGmailImported(
  account: ConnectedAccount,
  importedCount: number,
  now = new Date(),
): ConnectedAccount {
  return {
    ...account,
    status: "connected",
    lastImportedAt: now.toISOString(),
    message: `${importedCount} Gmail messages imported into the inbox queue.`,
  };
}

export async function fetchRealGmailMessages(
  businessId: string,
  maxResults = 5,
): Promise<InboxMessage[]> {
  const list = (await gmailApiRequest(
    businessId,
    `/messages?${new URLSearchParams({
      maxResults: String(maxResults),
      q: "newer_than:30d",
    })}`,
  )) as GmailMessageListResponse;
  const messages = list.messages ?? [];
  const fullMessages = await Promise.all(
    messages.map(async (message) => {
      return (await gmailApiRequest(
        businessId,
        `/messages/${message.id}?format=full`,
      )) as GmailMessageResponse;
    }),
  );

  return fullMessages.map(mapGmailMessage);
}

async function gmailApiRequest(businessId: string, path: string) {
  const token = await readGmailToken(businessId);

  if (!token?.access_token) {
    throw new Error("No Gmail OAuth token is stored for this workspace.");
  }

  let response = await fetch(`${gmailApiBaseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });

  if (response.status === 401 && token.refresh_token) {
    const refreshed = await refreshGmailAccessToken(token.refresh_token);
    const nextToken = {
      ...token,
      ...refreshed,
      refresh_token: refreshed.refresh_token ?? token.refresh_token,
    };
    await storeGmailToken(businessId, nextToken);
    response = await fetch(`${gmailApiBaseUrl}${path}`, {
      headers: { Authorization: `Bearer ${nextToken.access_token}` },
    });
  }

  if (!response.ok) {
    throw new Error(`Gmail API request failed with ${response.status}.`);
  }

  return response.json();
}

async function refreshGmailAccessToken(refreshToken: string) {
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google token refresh failed with ${response.status}.`);
  }

  return (await response.json()) as GoogleTokenResponse;
}

function mapGmailMessage(message: GmailMessageResponse): InboxMessage {
  const headers = message.payload?.headers ?? [];
  const from = headerValue(headers, "From") ?? "unknown@gmail.com";
  const subject = headerValue(headers, "Subject") ?? "No subject";
  const body = extractBody(message) || message.snippet || subject;

  return {
    id: `gmail-real-${message.id}`,
    from,
    subject,
    receivedAt: "Imported from Gmail",
    preview: (message.snippet || body).slice(0, 140),
    body,
    status: "unscanned",
    estimatedValue: estimateValue(body),
  };
}

function extractBody(message: GmailMessageResponse) {
  const directBody = decodeBase64Url(message.payload?.body?.data);

  if (directBody) {
    return directBody;
  }

  for (const part of message.payload?.parts ?? []) {
    const body = decodeBase64Url(part.body?.data);

    if (body) {
      return body;
    }

    for (const nested of part.parts ?? []) {
      const nestedBody = decodeBase64Url(nested.body?.data);

      if (nestedBody) {
        return nestedBody;
      }
    }
  }

  return "";
}

function decodeBase64Url(value: string | undefined) {
  if (!value) {
    return "";
  }

  return Buffer.from(value, "base64url").toString("utf8");
}

function headerValue(headers: Array<{ name: string; value: string }>, name: string) {
  return headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value;
}

function estimateValue(text: string) {
  const match = text.match(/[£$]\s?([0-9][0-9,]*)/u);

  if (!match) {
    return 0;
  }

  return Number(match[1].replaceAll(",", ""));
}

function createOAuthState(businessId: string) {
  const payload = Buffer.from(
    JSON.stringify({ businessId, createdAt: new Date().toISOString() }),
  ).toString("base64url");

  return `${payload}.${signState(payload)}`;
}

function signState(payload: string) {
  return createHmac("sha256", oauthSecret()).update(payload).digest("base64url");
}

function oauthSecret() {
  return process.env.OPSPILOT_SESSION_SECRET ?? "opspilot-local-dev-secret";
}

async function readTokenStore() {
  try {
    const raw = await readFile(tokenStorePath, "utf8");
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeTokenStore(tokens: Record<string, string>) {
  await mkdir(dirname(tokenStorePath), { recursive: true });
  await writeFile(tokenStorePath, JSON.stringify(tokens, null, 2));
}

function gmailTokenKey(businessId: string) {
  return `${businessId}:gmail`;
}

function encryptToken(token: StoredGoogleToken) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(token), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [iv, tag, encrypted].map((item) => item.toString("base64url")).join(".");
}

function decryptToken(value: string): StoredGoogleToken {
  const [iv, tag, encrypted] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", tokenEncryptionKey(), iv);
  decipher.setAuthTag(tag);

  return JSON.parse(
    Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8"),
  ) as StoredGoogleToken;
}

function tokenEncryptionKey() {
  return createHmac("sha256", "opspilot-token-key")
    .update(process.env.OPSPILOT_TOKEN_ENCRYPTION_KEY ?? oauthSecret())
    .digest();
}

function requiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required for Gmail OAuth.`);
  }

  return value;
}
