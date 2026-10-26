"""연결 확인: 국토부 API 한 번 호출, 텔레그램 대화방 ID 찾기, 테스트 메시지 보내기.

실행: .venv/Scripts/python -m rebot.check_setup
"""

import xml.etree.ElementTree as ET
from datetime import date

import httpx

from rebot import config

APT_TRADE_URL = (
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev"
)
BUNDANG = "41135"  # 성남시 분당구


def check_molit() -> None:
    today = date.today()
    prev = date(today.year - (today.month == 1), (today.month - 2) % 12 + 1, 1)
    ymd = prev.strftime("%Y%m")
    res = httpx.get(
        APT_TRADE_URL,
        params={
            "serviceKey": config.get("DATA_GO_KR_KEY"),
            "LAWD_CD": BUNDANG,
            "DEAL_YMD": ymd,
            "pageNo": 1,
            "numOfRows": 3,
        },
        timeout=30,
    )
    print(f"[국토부] HTTP {res.status_code}")
    try:
        root = ET.fromstring(res.text)
    except ET.ParseError:
        print("  응답이 XML이 아닙니다:", res.text[:200])
        return
    code = root.findtext(".//resultCode")
    msg = root.findtext(".//resultMsg")
    total = root.findtext(".//totalCount")
    print(f"  resultCode={code} ({msg}), {ymd} 분당구 거래 {total}건")
    item = root.find(".//item")
    if item is not None:
        print("  항목:", ", ".join(child.tag for child in item))
        fields = ["sggCd", "umdNm", "aptNm", "excluUseAr", "floor", "dealAmount", "dealDay"]
        print("  예시:", {f: item.findtext(f) for f in fields})


def check_telegram() -> None:
    token = config.get("TELEGRAM_BOT_TOKEN")
    base = f"https://api.telegram.org/bot{token}"
    me = httpx.get(f"{base}/getMe", timeout=30).json()
    if not me.get("ok"):
        print("[텔레그램] 토큰이 올바르지 않습니다:", me.get("description"))
        return
    print(f"[텔레그램] 봇 이름: @{me['result']['username']}")

    chat_id = config.get("TELEGRAM_CHAT_ID", required=False)
    if not chat_id:
        updates = httpx.get(f"{base}/getUpdates", timeout=30).json().get("result", [])
        chats = {
            u["message"]["chat"]["id"]: u["message"]["chat"].get("first_name", "")
            for u in updates
            if "message" in u
        }
        if not chats:
            print("  대화방을 찾지 못했습니다. 텔레그램에서 봇에게 아무 메시지나 보낸 뒤 다시 실행하세요.")
            return
        chat_id = str(next(iter(chats)))
        config.set_env_file_value("TELEGRAM_CHAT_ID", chat_id)
        print("  대화방 ID를 찾아 .env에 저장했습니다.")

    sent = httpx.post(
        f"{base}/sendMessage",
        json={"chat_id": chat_id, "text": "✅ 실거래가 알림봇 연결 테스트 메시지입니다."},
        timeout=30,
    ).json()
    print("  테스트 메시지:", "보냄" if sent.get("ok") else sent.get("description"))


if __name__ == "__main__":
    check_molit()
    check_telegram()
