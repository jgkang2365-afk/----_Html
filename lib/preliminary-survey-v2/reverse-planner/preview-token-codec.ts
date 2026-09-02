import { createHmac, timingSafeEqual, type BinaryLike } from "node:crypto";
import type { PlannerRouteEvidence } from "./types";

export const PREVIEW_TOKEN_TTL_MS = 15 * 60 * 1000;

export type PreviewTokenPayload = {
  actorUserId: number;
  measurementDate: string;
  sourceFingerprint: string;
  routeEvidence: PlannerRouteEvidence[];
  effectiveMeasurementAssignments?: Array<{
    targetId: number;
    measurementDate: string;
    assigneeUserId: number;
    assignmentOrigin: "confirmed" | "automatic";
    surveyCode?: string;
    publicSampleCode?: string;
  }>;
  expiresAt: number;
};

function signature(encoded: string, secret: BinaryLike) {
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}

export function createSignedPreviewToken(
  input: Omit<PreviewTokenPayload, "expiresAt">,
  secret: BinaryLike,
  now = Date.now(),
) {
  const payload: PreviewTokenPayload = { ...input, expiresAt: now + PREVIEW_TOKEN_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifySignedPreviewToken(
  token: string,
  actorUserId: number,
  measurementDate: string,
  secret: BinaryLike,
  now = Date.now(),
) {
  try {
    const [encoded, suppliedSignature, extra] = token.split(".");
    if (!encoded || !suppliedSignature || extra) throw new Error("INVALID_PREVIEW_TOKEN");
    const expected = Buffer.from(signature(encoded, secret));
    const supplied = Buffer.from(suppliedSignature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new Error("INVALID_PREVIEW_TOKEN");
    }
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PreviewTokenPayload;
    if (payload.actorUserId !== actorUserId || payload.measurementDate !== measurementDate
        || payload.expiresAt <= now || !Array.isArray(payload.routeEvidence)
        || !Array.isArray(payload.effectiveMeasurementAssignments)
        || typeof payload.sourceFingerprint !== "string") {
      throw new Error("INVALID_PREVIEW_TOKEN");
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_PREVIEW_TOKEN") throw error;
    throw new Error("INVALID_PREVIEW_TOKEN");
  }
}
