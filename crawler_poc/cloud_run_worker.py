"""
Cloud Run PoC Worker — KEPCO API 호출 가능 여부 검증

목적: Cloud Run (asia-northeast3 / 서울 region) IP 가
      KEPCO 사이트로부터 차단되지 않는지 1회 호출로 검증.

Cloud Run Service 형태로 배포되며, HTTP 요청을 받으면
KEPCO API 를 1회 호출하고 결과를 JSON 으로 반환한다.

판정 기준:
  - 200 OK + 시/도 17개 반환 → 통과 (Phase 1 진행 가능)
  - 403 / 빈 응답 / 타임아웃 → 차단 (다른 region 또는 VPS 검토)
"""
import json
import os
import random
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

import requests

BASE_URL = "https://online.kepco.co.kr"

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
]

HEADERS = {
    "Content-Type": "application/json",
    "Referer": "https://online.kepco.co.kr/EWM092D00",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Origin": "https://online.kepco.co.kr",
    "X-Requested-With": "XMLHttpRequest",
}


def call_kepco_sido_list() -> dict:
    """KEPCO 시/도 목록 조회 (가장 단순한 호출)"""
    session = requests.Session()
    ua = random.choice(USER_AGENTS)
    session.headers.update({**HEADERS, "User-Agent": ua})

    result = {
        "user_agent": ua,
        "step1_warmup": None,
        "step2_api_call": None,
    }

    try:
        warmup = session.get(f"{BASE_URL}/EWM092D00", timeout=30)
        result["step1_warmup"] = {
            "status": warmup.status_code,
            "ok": warmup.ok,
            "cookies": dict(warmup.cookies),
        }
    except Exception as e:
        result["step1_warmup"] = {"error": f"{type(e).__name__}: {e}"}

    try:
        body = json.dumps({}, ensure_ascii=False).encode("utf-8")
        resp = session.post(
            f"{BASE_URL}/ew/cpct/retrieveAddrInit",
            data=body,
            timeout=30,
        )
        resp.encoding = "utf-8"
        try:
            payload = resp.json()
            sido_count = len(payload.get("dlt_sido", []))
            sido_sample = [
                item.get("ADDR_DO", "")
                for item in payload.get("dlt_sido", [])[:5]
            ]
        except Exception:
            payload = None
            sido_count = 0
            sido_sample = []

        result["step2_api_call"] = {
            "status": resp.status_code,
            "ok": resp.ok,
            "sido_count": sido_count,
            "sido_sample": sido_sample,
            "raw_text_head": resp.text[:300] if not payload else None,
        }
    except Exception as e:
        result["step2_api_call"] = {"error": f"{type(e).__name__}: {e}"}

    verdict_pass = (
        result["step2_api_call"]
        and result["step2_api_call"].get("ok")
        and result["step2_api_call"].get("sido_count", 0) >= 15
    )
    result["verdict"] = "PASS" if verdict_pass else "FAIL"
    return result


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/" or path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(
                json.dumps({"status": "ok", "service": "kepco-poc-worker"}).encode("utf-8")
            )
            return

        if path == "/check":
            print("[PoC] KEPCO API 호출 시작", flush=True)
            result = call_kepco_sido_list()
            print(f"[PoC] 결과: {json.dumps(result, ensure_ascii=False)}", flush=True)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps(result, ensure_ascii=False, indent=2).encode("utf-8"))
            return

        self.send_response(404)
        self.end_headers()

    def log_message(self, format, *args):
        print(f"[HTTP] {format % args}", flush=True)


def main():
    port = int(os.environ.get("PORT", "8080"))
    server = HTTPServer(("0.0.0.0", port), Handler)
    print(f"[PoC] Listening on :{port} — GET /check 로 KEPCO 검증 가능", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
