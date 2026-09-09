import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const encoder = new TextEncoder();
const PIN_PATTERN = /^[0-9]{4}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REQUEST_CHARACTERS = 128;
const DEFAULT_ALLOWED_ORIGINS = [
  "https://intothem.co.kr",
  "https://www.intothem.co.kr",
];

type ClaimRow = {
  writer_id: string | null;
  is_allowed: boolean;
  retry_after_seconds: number;
};

function allowedOrigins(): Set<string> {
  const configured = (Deno.env.get("WRITER_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true;
  return allowedOrigins().has(origin);
}

function responseHeaders(origin: string | null): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  });

  if (origin && isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, x-client-info, apikey, content-type",
    );
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Expose-Headers", "Retry-After");
    headers.set("Access-Control-Max-Age", "86400");
  }

  return headers;
}

function jsonResponse(
  origin: string | null,
  status: number,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = responseHeaders(origin);
  for (const [name, value] of Object.entries(extraHeaders ?? {})) {
    headers.set(name, value);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function readSecretApiKey(): string {
  const keyDictionary = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keyDictionary) {
    try {
      const keys = JSON.parse(keyDictionary) as Record<string, unknown>;
      if (typeof keys.default === "string" && keys.default.length > 0) {
        return keys.default;
      }

      const firstKey = Object.values(keys).find(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
      if (firstKey) return firstKey;
    } catch {
      // Configuration failures are returned as a generic unavailable response below.
    }
  }

  const explicitKey = Deno.env.get("SUPABASE_SECRET_KEY");
  if (explicitKey) return explicitKey;

  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacyKey) return legacyKey;

  throw new Error("Supabase secret API key is not configured");
}

function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const candidate = request.headers.get("cf-connecting-ip")?.trim()
    ?? forwarded?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")?.trim();

  if (!candidate || candidate.length > 128 || /[^0-9a-f:.]/i.test(candidate)) {
    return "unknown";
  }

  return candidate.toLowerCase();
}

async function importHmacKey(pepper: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function hmacHex(key: CryptoKey, message: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function parsePin(request: Request): Promise<string | null> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_CHARACTERS) {
    return null;
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_REQUEST_CHARACTERS) return null;

  try {
    const body = JSON.parse(rawBody) as { pin?: unknown };
    return typeof body.pin === "string" && PIN_PATTERN.test(body.pin) ? body.pin : null;
  } catch {
    return null;
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get("origin");

  if (!isAllowedOrigin(origin)) {
    return jsonResponse(null, 403, { error: "request_not_allowed" });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders(origin) });
  }

  if (request.method !== "POST") {
    return jsonResponse(origin, 405, { error: "method_not_allowed" }, { Allow: "POST, OPTIONS" });
  }

  const pin = await parsePin(request);
  if (!pin) {
    return jsonResponse(origin, 400, { error: "invalid_request" });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const pepper = Deno.env.get("WRITER_PIN_PEPPER");
    if (!supabaseUrl || !pepper || pepper.length < 32) {
      throw new Error("Writer PIN authentication is not configured");
    }

    const secretApiKey = readSecretApiKey();
    const hmacKey = await importHmacKey(pepper);
    const [pinDigest, rateKey] = await Promise.all([
      hmacHex(hmacKey, `writer-pin:v1:${pin}`),
      hmacHex(hmacKey, `writer-rate:v1:${clientAddress(request)}`),
    ]);

    const admin = createClient(supabaseUrl, secretApiKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });

    const { data: claimData, error: claimError } = await admin.rpc("claim_writer_pin", {
      p_pin_digest: pinDigest,
      p_rate_key: rateKey,
    });
    if (claimError) throw new Error("PIN claim failed");

    const claim = (Array.isArray(claimData) ? claimData[0] : claimData) as ClaimRow | null;
    if (!claim || typeof claim.is_allowed !== "boolean") {
      throw new Error("PIN claim returned an invalid response");
    }

    if (!claim.is_allowed) {
      const retryAfter = Math.max(1, Number(claim.retry_after_seconds) || 1);
      return jsonResponse(
        origin,
        429,
        { error: "too_many_attempts", retry_after_seconds: retryAfter },
        { "Retry-After": String(retryAfter) },
      );
    }

    if (!claim.writer_id) {
      return jsonResponse(origin, 401, { error: "invalid_pin" });
    }

    if (!UUID_PATTERN.test(claim.writer_id)) {
      throw new Error("PIN claim returned an invalid writer ID");
    }

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(claim.writer_id);
    const email = userData.user?.email;
    if (userError || !email) throw new Error("Writer auth user is unavailable");

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const tokenHash = linkData.properties?.hashed_token;
    if (linkError || !tokenHash) throw new Error("Writer session token could not be generated");

    return jsonResponse(origin, 200, { token_hash: tokenHash, verification_type: "email" });
  } catch {
    // Never include PINs, digests, auth emails, token hashes, or secret values in logs/responses.
    return jsonResponse(origin, 503, { error: "service_unavailable" });
  }
});
