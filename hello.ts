// TFlex API - JWT-gated signature image storage in the private `tflex` bucket.
import { createRemoteJWKSet, jwtVerify } from "jose";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET = "tflex";
const MAX_BYTES = 256 * 1024;              // 256 KB cap per signature image
const jwksUrl = process.env.NEON_AUTH_JWKS_URL;
const authBase = process.env.NEON_AUTH_BASE_URL;
const jwks = jwksUrl ? createRemoteJWKSet(new URL(jwksUrl)) : null;

const s3 = new S3Client({
  forcePathStyle: true,                    // Neon storage requires path-style addressing
  region: process.env.AWS_REGION,
  endpoint: process.env.AWS_ENDPOINT_URL_S3,
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function verifiedUserId(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ") || !jwks) return null;
  try {
    const { payload } = await jwtVerify(auth.slice(7), jwks, {
      issuer: authBase ? new URL(authBase).origin : undefined,
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return json({
        ok: true,
        authEnv: Boolean(jwksUrl && authBase),
        storageEnv: Boolean(
          process.env.AWS_ACCESS_KEY_ID && process.env.AWS_ENDPOINT_URL_S3 && process.env.AWS_REGION,
        ),
      });
    }

    const userId = await verifiedUserId(request);
    if (!userId) return json({ error: "unauthorized" }, 401);

    if (request.method === "POST" && url.pathname === "/signatures") {
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return json({ error: "bad-size" }, 413);
      const key = `signatures/${userId}/${crypto.randomUUID()}.png`;
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: key, Body: bytes,
        ContentType: request.headers.get("content-type") ?? "image/png",
      }));
      return json({ key });
    }

    if (request.method === "GET" && url.pathname.startsWith("/signatures/")) {
      const key = decodeURIComponent(url.pathname.slice("/signatures/".length));
      if (!key.startsWith(`signatures/${userId}/`)) return json({ error: "forbidden" }, 403);
      const signed = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 300 });
      return json({ url: signed });
    }

    return json({ error: "not-found" }, 404);
  },
};