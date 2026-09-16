const EXERCISE_PRICE_CNY = 0.025;
const TOTAL_SHARES = 150000;
const MILLION_TARGET = 1000000;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let currentPeriod = "1M";
let latestMetrics = null;
let toastTimer = null;
let aiConfigured = false;
let currentMarketSeries = null;

function assertApiAvailable() {
  if (location.protocol === "file:") {
    throw new Error("当前是 file:// 静态打开，行情和 AI 接口无法连接。请用本地服务或 Vercel 链接打开页面。");
  }
}

async function fetchJson(url, options) {
  assertApiAvailable();
  const response = await fetch(url, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "请求失败");
  return result;
}

function formatCurrency(value) {
  return `¥${Math.round(value).toLocaleString("zh-CN")}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message) {
  const box = $("#toast");
  box.textContent = message;
  box.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove("show"), 2600);
}

function formatTimestamp(date = new Date()) {
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function updateMarketTimestamp(date = new Date(), source = "行情源") {
  $("#market-updated-at").textContent = `${formatTimestamp(date)}（北京时间）`;
  $("#market-updated-at").title = source;
}

async function fetchMarket(period = currentPeriod, button) {
  const target = button || $("#refresh-market");
  const original = target.textContent;
  target.textContent = "...";
  target.disabled = true;
  try {
    const result = await fetchJson(`/api/market/quote?period=${encodeURIComponent(period)}`);

    currentPeriod = result.period || period;
    currentMarketSeries = {
      labels: result.labels || [],
      data: result.data || [],
      volumes: result.volumes || [],
      turnovers: result.turnovers || [],
      floatShares: result.floatShares || 1726199340
    };

    $("#price").value = Number(result.price).toFixed(2);
    $("#display-price").textContent = Number(result.price).toFixed(2);
    const isUp = Number(result.change) >= 0;
    $("#display-change").textContent =
      `${isUp ? "▲" : "▼"} ${Math.abs(Number(result.change)).toFixed(2)} (${Number(result.changePct).toFixed(2)}%)`;
    $("#display-change").className = `stock-change ${isUp ? "up" : "down"}`;

    calculate();
    drawChart(currentMarketSeries.labels, currentMarketSeries.data);
    drawVolumeChart(currentMarketSeries.labels, currentMarketSeries.volumes, currentMarketSeries.data);
    renderLiquidity(currentMarketSeries);
    updateMarketTimestamp(new Date(result.updatedAt), result.source || "行情源");
    toast(`行情已更新：${Number(result.price).toFixed(2)} ${result.currency || "HKD"}`);
  } catch (error) {
    toast(`行情更新失败：${error.message}`);
    $("#market-updated-at").textContent = `行情更新失败：${error.message}`;
  } finally {
    target.textContent = original;
    target.disabled = false;
  }
}

async function fetchRate(button) {
  const target = button || $("#refresh-rate");
  const original = target.textContent;
  target.textContent = "...";
  target.disabled = true;
  try {
    const result = await fetchJson("/api/market/rate");
    $("#rate").value = Number(result.rate).toFixed(4);
    calculate();
    toast(`汇率已更新：1 ${result.base} = ${Number(result.rate).toFixed(4)} ${result.quote}`);
  } catch (error) {
    toast(`汇率更新失败：${error.message}`);
  } finally {
    target.textContent = original;
    target.disabled = false;
  }
}

function drawChart(labels = [], data = []) {
  if (!labels.length || !data.length) return;
  const first = data[0];
  const last = data[data.length - 1];
  const isUp = last >= first;
  const color = isUp ? "#059669" : "#dc2626";
  const canvas = $("#stock-chart");
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const padding = { top: 12, right: 10, bottom: 26, left: 40 };
  const width = rect.width - padding.left - padding.right;
  const height = rect.height - padding.top - padding.bottom;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const spread = Math.max(max - min, 1);
  const yFor = (value) => padding.top + (max - value) / spread * height;
  const xFor = (index) => padding.left + index / Math.max(data.length - 1, 1) * width;

  ctx.lineWidth = 1;
  ctx.strokeStyle = "#f0f1f5";
  ctx.fillStyle = "#9ca3af";
  ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + (height / 4) * i;
    const value = max - (spread / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(rect.width - padding.right, y);
    ctx.stroke();
    ctx.fillText(value.toFixed(1), padding.left - 8, y);
  }

  ctx.save();
  ctx.beginPath();
  data.forEach((value, index) => {
    const x = xFor(index);
    const y = yFor(value);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(xFor(data.length - 1), padding.top + height);
  ctx.lineTo(xFor(0), padding.top + height);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + height);
  gradient.addColorStop(0, isUp ? "rgba(5,150,105,0.16)" : "rgba(220,38,38,0.16)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  data.forEach((value, index) => {
    const x = xFor(index);
    const y = yFor(value);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();

  const tickIndexes = [0, Math.floor(data.length / 2), data.length - 1];
  ctx.fillStyle = "#9ca3af";
  ctx.textBaseline = "top";
  tickIndexes.forEach((index, tick) => {
    ctx.textAlign = tick === 0 ? "left" : tick === 1 ? "center" : "right";
    ctx.fillText(labels[index], xFor(index), padding.top + height + 10);
  });

}

function fmtVolumeShares(shares) {
  if (!Number.isFinite(shares) || shares <= 0) return "--";
  if (shares >= 1e8) return `${(shares / 1e8).toFixed(2)} 亿股`;
  if (shares >= 1e4) return `${(shares / 1e4).toFixed(1)} 万股`;
  return `${Math.round(shares)} 股`;
}

function fmtHkd(value) {
  if (!Number.isFinite(value) || value <= 0) return "--";
  if (value >= 1e8) return `${(value / 1e8).toFixed(2)} 亿港元`;
  if (value >= 1e4) return `${(value / 1e4).toFixed(1)} 万港元`;
  return `${Math.round(value).toLocaleString("zh-CN")} 港元`;
}

function mean(values) {
  const valid = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function drawVolumeChart(labels = [], volumes = [], closes = []) {
  const canvas = $("#volume-chart");
  if (!canvas || !labels.length || !volumes.length) return;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const padding = { top: 10, right: 10, bottom: 24, left: 48 };
  const width = rect.width - padding.left - padding.right;
  const height = rect.height - padding.top - padding.bottom;
  const maxVolume = Math.max(...volumes, 1);
  const slot = width / volumes.length;
  const barWidth = Math.max(1, slot * 0.62);

  ctx.strokeStyle = "#f0f1f5";
  ctx.fillStyle = "#9ca3af";
  ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 2; i += 1) {
    const y = padding.top + (height / 2) * i;
    const value = maxVolume - (maxVolume / 2) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(rect.width - padding.right, y);
    ctx.stroke();
    ctx.fillText(fmtVolumeShares(value), padding.left - 8, y);
  }

  volumes.forEach((volume, index) => {
    const x = padding.left + slot * index + (slot - barWidth) / 2;
    const barHeight = Math.max(1, (volume / maxVolume) * height);
    const y = padding.top + height - barHeight;
    const up = index === 0 ? true : Number(closes[index]) >= Number(closes[index - 1]);
    ctx.fillStyle = up ? "#059669" : "#dc2626";
    ctx.fillRect(x, y, barWidth, barHeight);
  });

  const tickIndexes = [0, Math.floor(volumes.length / 2), volumes.length - 1];
  ctx.fillStyle = "#9ca3af";
  ctx.textBaseline = "top";
  tickIndexes.forEach((index, tick) => {
    const x = padding.left + slot * index + slot / 2;
    ctx.textAlign = tick === 0 ? "left" : tick === 1 ? "center" : "right";
    ctx.fillText(labels[index], x, padding.top + height + 8);
  });
}

function renderLiquidity(series) {
  const volumes = series.volumes || [];
  const turnovers = series.turnovers || [];
  const closes = series.data || [];
  const floatShares = series.floatShares || 1726199340;
  const ids = ["lm-volume", "lm-turnover", "lm-turnover-rate", "lm-volume-ratio", "lm-avg5", "lm-avg20"];
  if (volumes.length < 2) {
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = "--";
    });
    const rating = document.getElementById("liquidity-rating");
    if (rating) {
      rating.textContent = "暂无成交量数据";
      rating.className = "liquidity-rating";
    }
    return;
  }
  const last = volumes.length - 1;
  const lastVol = volumes[last];
  const lastTurnover = turnovers[last] || Math.round(lastVol * Number(closes[last]));
  const turnoverRate = (lastVol / floatShares) * 100;

  const avg5 = mean(volumes.slice(Math.max(0, last - 5), last));
  const volumeRatio = avg5 ? lastVol / avg5 : 0;
  const avg20 = mean(volumes.slice(Math.max(0, last - 20), last));

  const elVol = document.getElementById("lm-volume");
  const elTurn = document.getElementById("lm-turnover");
  const elRate = document.getElementById("lm-turnover-rate");
  const elRatio = document.getElementById("lm-volume-ratio");
  const elAvg5 = document.getElementById("lm-avg5");
  const elAvg20 = document.getElementById("lm-avg20");
  if (elVol) elVol.textContent = fmtVolumeShares(lastVol);
  if (elTurn) elTurn.textContent = fmtHkd(lastTurnover);
  if (elRate) elRate.textContent = `${turnoverRate.toFixed(2)}%`;
  if (elRatio) elRatio.textContent = avg5 ? volumeRatio.toFixed(2) : "--";
  if (elAvg5) elAvg5.textContent = fmtVolumeShares(avg5);
  if (elAvg20) elAvg20.textContent = fmtVolumeShares(avg20);

  const rating = document.getElementById("liquidity-rating");
  if (rating) {
    const avgTurnover = mean(turnovers.slice(Math.max(0, last - 20), last));
    const ratio = avgTurnover ? lastTurnover / avgTurnover : 1;
    let text;
    let cls;
    if (ratio >= 1.5) {
      text = `放量 · 流动性活跃（成交约为近 20 日均值 ${ratio.toFixed(1)} 倍）`;
      cls = "active";
    } else if (ratio <= 0.6) {
      text = `缩量 · 流动性偏弱（成交约为近 20 日均值 ${ratio.toFixed(1)} 倍）`;
      cls = "quiet";
    } else {
      text = `量能平稳（成交约为近 20 日均值 ${ratio.toFixed(1)} 倍）`;
      cls = "steady";
    }
    rating.textContent = text;
    rating.className = `liquidity-rating ${cls}`;
  }
}

function renderChart() {
  if (!currentMarketSeries) return;
  drawChart(currentMarketSeries.labels, currentMarketSeries.data);
  drawVolumeChart(currentMarketSeries.labels, currentMarketSeries.volumes, currentMarketSeries.data);
  renderLiquidity(currentMarketSeries);
}

function calcTax(income) {
  const monthly = income / 12;
  let rate = 0.03;
  let deduct = 0;
  if (monthly <= 3000) [rate, deduct] = [0.03, 0];
  else if (monthly <= 12000) [rate, deduct] = [0.1, 210];
  else if (monthly <= 25000) [rate, deduct] = [0.2, 1410];
  else if (monthly <= 35000) [rate, deduct] = [0.25, 2660];
  else if (monthly <= 55000) [rate, deduct] = [0.3, 4410];
  else if (monthly <= 80000) [rate, deduct] = [0.35, 7160];
  else [rate, deduct] = [0.45, 15160];
  return Math.max((monthly * rate - deduct) * 12, 0);
}

function calculate() {
  const price = Number($("#price").value) || 0;
  const rate = Number($("#rate").value) || 0;
  const shares = Number($("#shares-slider").value) || 0;
  const assets = {
    financial: Number($("#asset-financial").value) || 0,
    cash: Number($("#asset-cash").value) || 0,
    other: Number($("#asset-other").value) || 0
  };
  assets.total = assets.financial + assets.cash + assets.other;
  const priceCny = price * rate;
  const gross = Math.max((priceCny - EXERCISE_PRICE_CNY) * shares, 0);
  const tax = gross > 0 ? calcTax(gross) : 0;
  const net = Math.max(gross - tax, 0);
  const millionTotal = net + assets.total;

  latestMetrics = { price, rate, shares, priceCny, gross, tax, net, assets, millionTotal };

  $("#gross").textContent = gross ? formatCurrency(gross) : "¥--";
  $("#tax").textContent = gross ? `-${formatCurrency(tax)}` : "¥--";
  $("#net").textContent = gross ? formatCurrency(net) : "¥--";
  $("#net-wan").textContent = gross ? (net / 10000).toFixed(1) : "--";
  $("#display-price").textContent = price.toFixed(2);
  $("#calc-price-used").textContent =
    `本次测算使用当前股价：${price.toFixed(2)} HKD，折合 ${priceCny.toFixed(3)} CNY/股`;

  if (gross) {
    const gap = MILLION_TARGET - millionTotal;
    $("#million-value").textContent = `¥${Math.round(millionTotal / 10000)}万`;
    $("#million-sub").textContent = gap <= 0
      ? `税后到手 ${formatCurrency(net)} + 常规资产 ${formatCurrency(assets.total)}，超出目标 ${formatCurrency(Math.abs(gap))}`
      : `税后到手 ${formatCurrency(net)} + 常规资产 ${formatCurrency(assets.total)}，还差 ${formatCurrency(gap)}`;
    $("#million-tag").textContent = gap <= 0 ? "已达成" : "未达成";
    $("#million-tag").style.background = gap <= 0 ? "#059669" : "#d97706";
  } else {
    $("#million-value").textContent = "¥--";
    $("#million-sub").textContent = "税后到手 + 常规资产是否超过 ¥100 万";
    $("#million-tag").textContent = "计算中";
  }
}

function updateShares(value) {
  const shares = Number(value);
  const pct = (shares / TOTAL_SHARES) * 100;
  $("#shares-display").textContent = shares.toLocaleString("zh-CN");
  $("#shares-pct").textContent = `${pct.toFixed(1)}%`;
  $("#shares-keep").textContent = (TOTAL_SHARES - shares).toLocaleString("zh-CN");
  $("#shares-slider").style.background =
    `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--surface-2) ${pct}%)`;
  $$("#quick-shares button").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.shares) === shares);
  });
  calculate();
}

async function postJson(url, body) {
  return fetchJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function generateAnalysis() {
  const button = $("#generate-analysis");
  const output = $("#ai-output");
  button.disabled = true;
  button.textContent = "AI 分析中...";
  output.className = "ai-output";
  output.textContent = "正在分析当前参数...";
  try {
    const result = await postJson("/api/quhe/analyze", latestMetrics);
    output.innerHTML = result.html;
  } catch (error) {
    output.innerHTML = `<strong>AI 请求失败：</strong>${escapeHtml(error.message)}`;
    toast("AI 请求失败，已显示错误详情");
  } finally {
    button.disabled = false;
    button.textContent = "重新生成 AI 分析";
  }
}

function appendChat(role, html) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role}`;
  bubble.innerHTML = `<b>${role === "user" ? "你" : "AI 助手"}</b>${html}`;
  $("#chat-history").appendChild(bubble);
  $("#chat-history").scrollTop = $("#chat-history").scrollHeight;
  return bubble;
}

async function sendChat(question) {
  const cleaned = question.trim();
  if (!cleaned) return;
  appendChat("user", escapeHtml(cleaned));
  const pending = appendChat("ai", "正在分析...");
  try {
    const result = await postJson("/api/quhe/chat", {
      question: cleaned,
      metrics: latestMetrics,
      clientTime: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
    });
    pending.innerHTML = `<b>AI 助手</b>${result.html}`;
  } catch (error) {
    pending.innerHTML = `<b>AI 助手</b>AI 请求失败：${escapeHtml(error.message)}`;
  }
  $("#chat-history").scrollTop = $("#chat-history").scrollHeight;
}

function openSettings() {
  $("#settings-modal").classList.add("open");
  $("#modal-backdrop").classList.add("open");
  $("#settings-modal").setAttribute("aria-hidden", "false");
}

function closeSettings() {
  $("#settings-modal").classList.remove("open");
  $("#modal-backdrop").classList.remove("open");
  $("#settings-modal").setAttribute("aria-hidden", "true");
}

function renderAiSettings(settings) {
  if (!settings) return;
  aiConfigured = Boolean(settings.configured);
  $("#zhipu-text-model").value = settings.textModel || "glm-4.7-flash";
  $("#api-key-hint").textContent = settings.configured
    ? `已保存 ${settings.keyHint}，输入新 Key 可覆盖`
    : "尚未配置";
  const status = $("#ai-status");
  status.className = "connection-pill";
  if (settings.connectionStatus === "connected") {
    status.textContent = "AI 已连接";
    status.classList.add("connected");
  } else if (settings.connectionStatus === "error") {
    status.textContent = "AI 连接失败";
    status.classList.add("error");
  } else {
    status.textContent = settings.configured ? "AI 待测试" : "AI 未配置";
  }
}

async function loadAiSettings() {
  if (location.protocol === "file:") {
    $("#ai-status").textContent = "需服务打开";
    $("#ai-status").className = "connection-pill error";
    $("#ai-output").innerHTML = "<strong>AI 暂不可用：</strong>当前是 file:// 静态打开，AI 接口无法连接。请用本地服务或 Vercel 链接打开页面。";
    return;
  }
  try {
    const result = await fetchJson("/api/settings/ai");
    renderAiSettings(result.settings);
  } catch (error) {
    $("#ai-status").textContent = "AI 状态未知";
    $("#ai-output").innerHTML = `<strong>AI 状态检查失败：</strong>${escapeHtml(error.message)}`;
  }
}

async function saveAiSettings(event) {
  event.preventDefault();
  const button = $("#save-settings");
  const errorBox = $("#settings-error");
  button.disabled = true;
  button.textContent = "测试中...";
  errorBox.classList.remove("show");
  try {
    const response = await fetch("/api/settings/ai", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiKey: $("#zhipu-api-key").value,
        textModel: $("#zhipu-text-model").value,
        visionModel: "glm-4.6v-flash"
      })
    });
    const result = await response.json();
    renderAiSettings(result.settings);
    if (!response.ok) throw new Error(result.error || "连接失败");
    $("#zhipu-api-key").value = "";
    closeSettings();
    toast(result.message || "智谱 AI 连接成功");
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.classList.add("show");
    toast("AI 设置保存失败");
  } finally {
    button.disabled = false;
    button.textContent = "保存并测试连接";
  }
}

$("#price").addEventListener("input", () => {
  calculate();
});
$("#rate").addEventListener("input", calculate);
["#asset-financial", "#asset-cash", "#asset-other"].forEach((selector) => {
  $(selector).addEventListener("input", calculate);
});
$("#shares-slider").addEventListener("input", (event) => updateShares(event.target.value));
$("#refresh-price").addEventListener("click", (event) => {
  fetchMarket(currentPeriod, event.target);
});
$("#refresh-market").addEventListener("click", (event) => fetchMarket(currentPeriod, event.target));
$("#refresh-rate").addEventListener("click", (event) => {
  fetchRate(event.target);
});
$$("#period-tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    $$("#period-tabs button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    fetchMarket(button.dataset.period, $("#refresh-market"));
  });
});
$$("#quick-shares button").forEach((button) => {
  button.addEventListener("click", () => {
    $("#shares-slider").value = button.dataset.shares;
    updateShares(button.dataset.shares);
  });
});
$("#generate-analysis").addEventListener("click", generateAnalysis);
$("#chat-form").addEventListener("submit", (event) => {
  event.preventDefault();
  sendChat($("#chat-input").value);
  $("#chat-input").value = "";
});
$("#chat-input").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  sendChat($("#chat-input").value);
  $("#chat-input").value = "";
});
$$("#suggested button").forEach((button) => {
  button.addEventListener("click", () => sendChat(button.textContent));
});
$("#open-settings").addEventListener("click", openSettings);
$("#close-settings").addEventListener("click", closeSettings);
$("#modal-backdrop").addEventListener("click", closeSettings);
$("#toggle-key").addEventListener("click", () => {
  const input = $("#zhipu-api-key");
  input.type = input.type === "password" ? "text" : "password";
  $("#toggle-key").textContent = input.type === "password" ? "显示" : "隐藏";
});
$("#settings-form").addEventListener("submit", saveAiSettings);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSettings();
});
window.addEventListener("resize", () => renderChart(currentPeriod));

updateShares(100000);
fetchMarket("1M", $("#refresh-market"));
fetchRate($("#refresh-rate"));
loadAiSettings();
