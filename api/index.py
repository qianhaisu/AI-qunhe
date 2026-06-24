from http.server import BaseHTTPRequestHandler
import json
import urllib.request
import urllib.error
import os

def fetch_stock_price():
    """Fetch 00068.HK price from Yahoo Finance"""
    url = "https://query1.finance.yahoo.com/v8/finance/chart/0068.HK?interval=1d&range=1d"
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read())
        meta = data["chart"]["result"][0]["meta"]
        price = meta.get("regularMarketPrice") or meta.get("previousClose")
        prev  = meta.get("previousClose", price)
        change = price - prev
        change_pct = (change / prev * 100) if prev else 0
        return {"price": round(price, 3), "change": round(change, 3), "change_pct": round(change_pct, 2), "currency": "HKD"}
    except Exception as e:
        return {"error": str(e)}

def fetch_hkd_cny_rate():
    """Fetch HKD/CNY rate from Yahoo Finance"""
    url = "https://query1.finance.yahoo.com/v8/finance/chart/HKDCNY=X?interval=1d&range=1d"
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read())
        meta = data["chart"]["result"][0]["meta"]
        rate = meta.get("regularMarketPrice") or meta.get("previousClose")
        return {"rate": round(rate, 4)}
    except Exception as e:
        return {"error": str(e)}

def fetch_history(period="1mo"):
    """Fetch historical price data"""
    ranges = {"1M": "1mo", "3M": "3mo", "6M": "6mo", "1Y": "1y"}
    r = ranges.get(period, "1mo")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/0068.HK?interval=1d&range={r}"
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read())
        result = data["chart"]["result"][0]
        timestamps = result["timestamp"]
        closes = result["indicators"]["quote"][0]["close"]
        points = []
        for ts, c in zip(timestamps, closes):
            if c is not None:
                from datetime import datetime, timezone
                dt = datetime.fromtimestamp(ts, tz=timezone.utc)
                points.append({"date": dt.strftime("%m/%d"), "price": round(c, 3)})
        return {"data": points}
    except Exception as e:
        return {"error": str(e)}

def ai_analyze(payload):
    """Call Claude via Nous API"""
    api_key = os.environ.get("CLAUDE_API_KEY", "")
    if not api_key:
        return {"error": "no_api_key"}

    price    = payload.get("price", 0)
    rate     = payload.get("rate", 0)
    shares   = payload.get("shares", 100000)
    net      = payload.get("net", 0)
    question = payload.get("question", "")

    if question:
        prompt = f"""你是一位专业的港股期权行权顾问。
用户持有群核科技（00068.HK）期权，行权价 0.025 CNY，共 150,000 股。
当前股价：{price} HKD，汇率：1 HKD = {rate} CNY，计划行权并卖出 {shares:,} 股，税后预计到手：¥{net:,.0f}。

用户问题：{question}

请用简洁中文回答（200字以内），结合用户的实际数字给出具体建议。"""
    else:
        prompt = f"""你是一位专业的港股期权行权顾问。
用户持有群核科技（00068.HK）期权，行权价 0.025 CNY，共 150,000 股。
当前股价：{price} HKD，汇率：1 HKD = {rate} CNY。
计划行权并卖出 {shares:,} 股，税后预计到手：¥{net:,.0f}。
行权日：2026年10月17日。

请从以下三个角度给出分析（总共200字以内，分段清晰）：
1. 当前价位评估
2. 核心风险（VC解禁抛压）
3. 行权建议"""

    body = json.dumps({
        "model": "claude-haiku-4-5",
        "max_tokens": 600,
        "messages": [{"role": "user", "content": prompt}]
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
            "User-Agent": "quhe-options/1.0"
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            resp = json.loads(r.read())
        text = resp["content"][0]["text"]
        return {"text": text}
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return {"error": f"HTTP {e.code}: {body}"}
    except Exception as e:
        return {"error": str(e)}


class handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # suppress default logs

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        params = {}
        if "?" in self.path:
            from urllib.parse import parse_qs
            qs = self.path.split("?", 1)[1]
            params = {k: v[0] for k, v in parse_qs(qs).items()}

        if path == "/api/price":
            result = fetch_stock_price()
        elif path == "/api/rate":
            result = fetch_hkd_cny_rate()
        elif path == "/api/history":
            result = fetch_history(params.get("period", "1M"))
        else:
            result = {"error": "not found"}
            self.send_response(404)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
            return

        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())

    def do_POST(self):
        path = self.path.split("?")[0]
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        if path == "/api/analyze":
            result = ai_analyze(body)
        else:
            result = {"error": "not found"}

        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
