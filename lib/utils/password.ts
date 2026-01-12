/**
 * 비밀번호 유틸리티 함수
 */

import * as bcrypt from "bcryptjs";

/**
 * 비밀번호를 해싱합니다.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * 비밀번호를 검증합니다.
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
