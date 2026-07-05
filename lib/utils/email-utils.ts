import React from "react";

/**
 * 이메일의 글자 수에 따라 동적으로 글자 크기를 결정합니다.
 * @param value 이메일 주소 문자열
 * @returns CSS font-size 값 또는 undefined
 */
export const getDynamicEmailFontSize = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  const len = value.length;
  if (len > 30) return "8px";
  if (len > 25) return "9px";
  if (len > 19) return "10px";
  if (len > 15) return "11px";
  return undefined; // 기본 CSS 크기 상속
};

/**
 * 쉼표(,) 또는 세미콜론(;) 구분자로 연결된 이메일 문자열을 분할하여 배열로 반환합니다.
 * @param emailStr 이메일 문자열
 * @returns 분할된 이메일 배열
 */
export const splitEmails = (emailStr: string | null | undefined): string[] => {
  if (!emailStr) return [];
  return emailStr
    .split(/[,;]/)
    .map((e) => e.trim())
    .filter(Boolean);
};
