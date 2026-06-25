// 群核期权助手 - Cloudflare Worker 后端
// 部署方式：粘贴到 Cloudflare Workers 编辑器，设置环境变量 ZHIPU_API_KEY

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // OPTIONS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    try {
      // GET /price — 获取 00068.HK 股价
      if (path.endsWith('/price') && request.method === 'GET') {
        const data = await fetchYahoo('0068.HK', '1d', '1d');
        const meta = data.chart.result[0].meta;
        const price = meta.regularMarketPrice || meta.previousClose;
        const prev = meta.previousClose || price;
        const change = price - prev;
        return json({ price: round(price, 3), change: round(change, 3), change_pct: round(change / prev * 100, 2) });
      }

      // GET /rate — 获取 HKD/CNY 汇率
      if (path.endsWith('/rate') && request.method === 'GET') {
        const data = await fetchYahoo('HKDCNY=X', '1d', '1d');
        const meta = data.chart.result[0].meta;
        const rate = meta.regularMarketPrice || meta.previousClose;
        return json({ rate: round(rate, 4) });
      }

      // GET /history?period=1M — 获取历史价格
      if (path.endsWith('/history') && request.method === 'GET') {
        const period = url.searchParams.get('period') || '1M';
        const rangeMap = { '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y' };
        const range = rangeMap[period] || '1mo';
        const data = await fetchYahoo('0068.HK', '1d', range);
        const result = data.chart.result[0];
        const timestamps = result.timestamp;
        const closes = result.indicators.quote[0].close;
        const points = timestamps.map((ts, i) => {
          if (closes[i] == null) return null;
          const d = new Date(ts * 1000);
          const date = `${d.getMonth() + 1}/${d.getDate()}`;
          return { date, price: round(closes[i], 3) };
        }).filter(Boolean);
        return json({ data: points });
      }

      // POST /analyze — AI 分析
      if (path.endsWith('/analyze') && request.method === 'POST') {
        const apiKey = env.ZHIPU_API_KEY;
        if (!apiKey) return json({ error: 'no_api_key' });

        const body = await request.json();
        const { price = 0, rate = 0, shares = 100000, net = 0, question = '' } = body;

        const prompt = question
          ? `你是一位专业的港股期权行权顾问。
用户持有群核科技（00068.HK）期权，行权价 0.025 CNY，共 150,000 股。
当前股价：${price} HKD，汇率：1 HKD = ${rate} CNY，计划行权并卖出 ${shares.toLocaleString()} 股，税后预计到手：¥${Math.round(net).toLocaleString()}。

用户问题：${question}

请用简洁中文回答（200字以内），结合用户的实际数字给出具体建议。`
          : `你是一位专业的港股期权行权顾问。
用户持有群核科技（00068.HK）期权，行权价 0.025 CNY，共 150,000 股。
当前股价：${price} HKD，汇率：1 HKD = ${rate} CNY。
计划行权并卖出 ${shares.toLocaleString()} 股，税后预计到手：¥${Math.round(net).toLocaleString()}。
行权日：2026年10月17日。

请从以下三个角度给出分析（总共200字以内，分段清晰）：
1. 当前价位评估
2. 核心风险（VC解禁抛压）
3. 行权建议`;

        const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model: 'glm-4-flash', messages: [{ role: 'user', content: prompt }], max_tokens: 600 }),
        });

        const result = await resp.json();
        const text = result?.choices?.[0]?.message?.content;
        if (text) return json({ text });
        return json({ error: JSON.stringify(result) });
      }

      return json({ error: 'not found' }, 404);

    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }
};

// ─── 工具函数 ───
async function fetchYahoo(symbol, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  return resp.json();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

function round(n, d) {
  return Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
}
