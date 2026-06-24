import json
import urllib.request
import urllib.error
import os
from urllib.parse import parse_qs, urlparse


def fetch_stock_price():
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
        return {"price": round(price, 3), "change": round(change, 3), "change_pct": round(change_pct, 2)}
    except Exception as e:
        return {"error": str(e)}


def fetch_rate():
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


def fetch_history(period="1M"):
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
    api_key = os.environ.get("ZHIPU_API_KEY", "")
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
        "model": "glm-4-flash",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 600
    }).encode()

    req = urllib.request.Request(
        "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "quhe-options/1.0"
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            resp = json.loads(r.read())
        text = resp["choices"][0]["message"]["content"]
        return {"text": text}
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        return {"error": f"HTTP {e.code}: {err}"}
    except Exception as e:
        return {"error": str(e)}


# ─── 腾讯云 SCF 入口 ───
def main_handler(event, context):
    cors_headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    }

    method = event.get("httpMethod", "GET")
    path   = event.get("path", "/")
    params = event.get("queryStringParameters") or {}

    # OPTIONS 预检
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": cors_headers, "body": ""}

    # GET 路由
    if method == "GET":
        if path.endswith("/price"):
            result = fetch_stock_price()
        elif path.endswith("/rate"):
            result = fetch_rate()
        elif path.endswith("/history"):
            result = fetch_history(params.get("period", "1M"))
        else:
            result = {"error": "not found"}
        return {"statusCode": 200, "headers": cors_headers, "body": json.dumps(result)}

    # POST 路由
    if method == "POST":
        if path.endswith("/analyze"):
            try:
                body = json.loads(event.get("body") or "{}")
            except Exception:
                body = {}
            result = ai_analyze(body)
        else:
            result = {"error": "not found"}
        return {"statusCode": 200, "headers": cors_headers, "body": json.dumps(result)}

    return {"statusCode": 405, "headers": cors_headers, "body": json.dumps({"error": "method not allowed"})}
