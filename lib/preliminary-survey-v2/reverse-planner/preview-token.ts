import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PlannerRouteEvidence } from "./types";

const TOKEN_TTL_MS = 15 * 60 * 1000;
type PreviewTokenPayload = {
  actorUserId: number;
  measurementDate: string;
  sourceFingerprint: string;
  routeEvidence: PlannerRouteEvidence[];
  expiresAt: number;
};

function secret() {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("PREVIEW_TOKEN_SECRET_UNAVAILABLE");
  return createHmac("sha256", value).update("reverse-planner-preview-token-v1").digest();
}

function signature(encoded: string) {
  return createHmac("sha256", secret()).update(encoded).digest("base64url");
}

export function createPreviewToken(input: Omit<PreviewTokenPayload, "expiresAt">) {
  const payload: PreviewTokenPayload = { ...input, expiresAt: Date.now() + TOKEN_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function verifyPreviewToken(token: string, actorUserId: number, measurementDate: string) {
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra) throw new Error("INVALID_PREVIEW_TOKEN");
  const expected = Buffer.from(signature(encoded));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error("INVALID_PREVIEW_TOKEN");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PreviewTokenPayload;
  if (payload.actorUserId !== actorUserId || payload.measurementDate !== measurementDate
      || payload.expiresAt <= Date.now() || !Array.isArray(payload.routeEvidence)) {
    throw new Error("INVALID_PREVIEW_TOKEN");
  }
  return payload;
}
