import "server-only";
import { createHmac } from "node:crypto";
import {
  createSignedPreviewToken,
  verifySignedPreviewToken,
  type PreviewTokenPayload,
} from "./preview-token-codec";

function secret() {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("PREVIEW_TOKEN_SECRET_UNAVAILABLE");
  return createHmac("sha256", value).update("reverse-planner-preview-token-v1").digest();
}

export function createPreviewToken(input: Omit<PreviewTokenPayload, "expiresAt">) {
  return createSignedPreviewToken(input, secret());
}

export function verifyPreviewToken(token: string, actorUserId: number, measurementDate: string) {
  return verifySignedPreviewToken(token, actorUserId, measurementDate, secret());
}
