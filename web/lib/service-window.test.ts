import { describe, it, expect, afterEach } from "vitest";
import { isServiceExpired } from "./service-window";

/** UTC 시각 헬퍼 */
const utc = (iso: string) => new Date(iso);

describe("isServiceExpired", () => {
  afterEach(() => {
    delete process.env.SERVICE_EXPIRES_AT;
  });

  describe("fail-open (환경변수 사고 방지)", () => {
    it("미설정이면 정상 운영", () => {
      delete process.env.SERVICE_EXPIRES_AT;
      expect(isServiceExpired(utc("2099-01-01T00:00:00Z"))).toBe(false);
    });

    it("빈 문자열이면 정상 운영", () => {
      process.env.SERVICE_EXPIRES_AT = "   ";
      expect(isServiceExpired(utc("2099-01-01T00:00:00Z"))).toBe(false);
    });

    it("형식이 잘못되면 정상 운영", () => {
      for (const bad of ["2026/08/20", "20260820", "아무말", "2026-8-2"]) {
        process.env.SERVICE_EXPIRES_AT = bad;
        expect(isServiceExpired(utc("2099-01-01T00:00:00Z"))).toBe(false);
      }
    });

    it("형식은 맞지만 실재하지 않는 날짜면 정상 운영", () => {
      process.env.SERVICE_EXPIRES_AT = "2026-13-45";
      expect(isServiceExpired(utc("2099-01-01T00:00:00Z"))).toBe(false);
    });
  });

  describe("KST 경계 판정 (핵심)", () => {
    // 만료일 2026-08-20 → KST 08-20 23:59:59 까지 유효
    // KST 08-21 00:00 = UTC 08-20 15:00
    const EXPIRES = "2026-08-20";

    it("만료일 당일 KST 오전은 유효", () => {
      process.env.SERVICE_EXPIRES_AT = EXPIRES;
      // KST 08-20 09:00 = UTC 08-20 00:00
      expect(isServiceExpired(utc("2026-08-20T00:00:00Z"))).toBe(false);
    });

    it("만료일 당일 KST 23:59:59 는 아직 유효", () => {
      process.env.SERVICE_EXPIRES_AT = EXPIRES;
      // KST 08-20 23:59:59 = UTC 08-20 14:59:59
      expect(isServiceExpired(utc("2026-08-20T14:59:59Z"))).toBe(false);
    });

    it("다음날 KST 00:00:00 부터 만료", () => {
      process.env.SERVICE_EXPIRES_AT = EXPIRES;
      // KST 08-21 00:00:00 = UTC 08-20 15:00:00
      expect(isServiceExpired(utc("2026-08-20T15:00:00Z"))).toBe(true);
    });

    it("UTC 기준으로 착각하면 틀리는 구간 — 9시간 밀림 방지", () => {
      process.env.SERVICE_EXPIRES_AT = EXPIRES;
      // UTC 08-20 23:00 = KST 08-21 08:00 → 이미 만료여야 함.
      // 만약 UTC 기준으로 판정했다면 아직 08-20 이라 false 가 나왔을 것.
      expect(isServiceExpired(utc("2026-08-20T23:00:00Z"))).toBe(true);
    });
  });

  describe("일반 케이스", () => {
    it("만료일이 한참 지났으면 만료", () => {
      process.env.SERVICE_EXPIRES_AT = "2026-01-01";
      expect(isServiceExpired(utc("2026-07-21T00:00:00Z"))).toBe(true);
    });

    it("만료일이 미래면 정상 운영", () => {
      process.env.SERVICE_EXPIRES_AT = "2026-12-31";
      expect(isServiceExpired(utc("2026-07-21T00:00:00Z"))).toBe(false);
    });
  });
});
