"""데스크탑 일일 갱신 — weekly-update.yml 과 같은 순서를 로컬에서 돈다.

  수집(최근 4개월 재수집) → 집계 → 좌표(키 있을 때) → 익스포트 → 최근 거래 → git push

사용:  .venv/Scripts/python pipeline/daily.py          (작업 스케줄러에 매일 새벽 등록)
       .venv/Scripts/python pipeline/daily.py --no-push
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from datetime import date
from pathlib import Path

import config as C

PY = sys.executable
ENV = {**os.environ, "PYTHONPATH": "pipeline", "PYTHONIOENCODING": "utf-8"}


def run(*args: str, check: bool = True) -> int:
    print(f"\n$ {' '.join(args)}", flush=True)
    return subprocess.run(args, cwd=C.ROOT, env=ENV, check=check).returncode


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=C.ROOT, check=False,
                          capture_output=True, text=True, encoding="utf-8")


def push() -> None:
    rel = str(Path(C.EXPORT_DIR).relative_to(C.ROOT))
    git("add", rel)
    if not git("status", "--porcelain", rel).stdout.strip():
        print("데이터 변경 없음 — 커밋하지 않음")
        return
    git("commit", "-m", f"data: 실거래 갱신 ({date.today().isoformat()})")
    r = git("push")
    print("push 완료" if r.returncode == 0 else f"push 실패:\n{r.stderr}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-push", action="store_true")
    args = ap.parse_args()

    # 쿼터 초과 등으로 수집이 중간에 멈춰도 받은 데이터까지로 나머지를 진행한다.
    run(PY, "pipeline/collect.py", "--all",
        "--refresh-recent", str(C.RECENT_REFETCH_MONTHS), check=False)
    run(PY, "pipeline/build.py")
    if os.environ.get("KAKAO_REST_KEY") or C.__dict__.get("KAKAO_REST_KEY"):
        run(PY, "pipeline/geocode.py", check=False)
    run(PY, "pipeline/export.py")
    run(PY, "pipeline/recent.py")
    if not args.no_push:
        push()
    return 0


if __name__ == "__main__":
    sys.exit(main())
