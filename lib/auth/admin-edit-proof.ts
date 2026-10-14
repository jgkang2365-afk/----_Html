import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

const COOKIE = "preliminary_admin_edit_proof";
const MAX_AGE = 7 * 24 * 60 * 60;

function sign(value: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("ADMIN_EDIT_PROOF_SECRET_UNAVAILABLE");
  return createHmac("sha256", secret).update(`preliminary-admin-edit-v1|${value}`).digest("hex");
}

export function setAdminEditProof(response: NextResponse, userId: number, role: string) {
  if (role !== "관리자") {
    response.cookies.delete(COOKIE);
    return;
  }
  const value = `${userId}.${Math.floor(Date.now() / 1000) + MAX_AGE}`;
  response.cookies.set(COOKIE, `${value}.${sign(value)}`, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
    maxAge: MAX_AGE, path: "/",
  });
}

export function clearAdminEditProof(response: NextResponse) {
  response.cookies.delete(COOKIE);
}

export async function hasAdminEditProof(userId: number) {
  const value = (await cookies()).get(COOKIE)?.value ?? "";
  const match = /^(\d+)\.(\d+)\.([0-9a-f]{64})$/.exec(value);
  if (!match || Number(match[1]) !== userId || Number(match[2]) < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(sign(`${match[1]}.${match[2]}`), "hex");
  const actual = Buffer.from(match[3], "hex");
  return timingSafeEqual(expected, actual);
}
