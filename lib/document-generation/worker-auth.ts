import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";

export function isAuthorizedDocumentWorker(request: NextRequest): boolean {
  const configured = process.env.DOCUMENT_WORKER_TOKEN || "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!configured || !supplied) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
