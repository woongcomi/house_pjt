"""설정: 환경 변수(GitHub Actions secrets) 또는 프로젝트 루트의 .env 에서 읽는다."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"


def _load_env_file() -> dict[str, str]:
    values: dict[str, str] = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                values[k.strip()] = v.strip().strip("\"'")
    return values


def get(name: str, required: bool = True) -> str | None:
    value = os.environ.get(name) or _load_env_file().get(name) or None
    if required and not value:
        raise SystemExit(f"{name} 이(가) 비어 있습니다. .env 파일을 확인해 주세요.")
    return value


def set_env_file_value(name: str, value: str) -> None:
    """.env 의 한 항목만 바꾼다 (텔레그램 대화방 ID 자동 저장용)."""
    lines = ENV_FILE.read_text(encoding="utf-8-sig").splitlines() if ENV_FILE.exists() else []
    for i, line in enumerate(lines):
        if line.startswith(f"{name}="):
            lines[i] = f"{name}={value}"
            break
    else:
        lines.append(f"{name}={value}")
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
