"""일일 갱신: 최근 3개월 재수집 → 사이트 데이터 생성 → docs/ 를 GitHub 에 push.

실행: .venv/Scripts/python -m rebot.daily
      (Windows 작업 스케줄러에 매일 새벽 등록)
"""

import subprocess
import sys
from datetime import date

from rebot import build_site, collect
from rebot.config import ROOT
from rebot.regions import REGIONS


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], check=False, cwd=ROOT, capture_output=True, text=True, encoding="utf-8"
    )


def push_site() -> None:
    if not git("remote").stdout.strip():
        print("git 원격이 없어 push 를 건너뜁니다.")
        return
    git("add", "docs")
    if not git("status", "--porcelain", "docs").stdout.strip():
        print("docs/ 변경 없음.")
        return
    git("commit", "-m", f"data: {date.today().isoformat()} 갱신")
    res = git("push")
    print("push 완료." if res.returncode == 0 else f"push 실패:\n{res.stderr}")


if __name__ == "__main__":
    try:
        collect.run(months=3, regions=list(REGIONS))
    except SystemExit as e:
        # 호출 한도 초과 등으로 수집이 중단돼도 이미 받은 데이터로 사이트는 갱신한다.
        print(f"수집 중단 (code {e.code}); 받은 데이터까지로 진행합니다.", file=sys.stderr)
    build_site.build()
    push_site()
