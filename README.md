# 群核期权助手

> 基于 AI 的港股期权行权决策工具

## 功能

- 📈 实时获取 00068.HK 股价和 HKD/CNY 汇率
- 💰 自动计算行权所得、个税（分月摊计法）、税后到手
- 🧠 Claude AI 生成决策分析
- 💬 对话式问答（行权策略、税务、最佳时机）

## 部署（Vercel）

### 1. Fork 或 clone 本仓库

### 2. 在 Vercel 导入项目

前往 [vercel.com](https://vercel.com) → Import Project → 选择本仓库

### 3. 设置环境变量

在 Vercel 项目设置 → Environment Variables 添加：

| 变量名 | 说明 |
|--------|------|
| `CLAUDE_API_KEY` | Anthropic API Key（可选，无则 AI 功能不可用） |

### 4. 部署完成

Vercel 会自动构建并给你一个 `https://xxx.vercel.app` 链接，手机电脑均可直接访问。

## 本地开发

```bash
npx vercel dev
```

## 技术栈

- 前端：原生 HTML + Chart.js
- 后端：Python（Vercel Serverless Functions）
- 数据：Yahoo Finance API
- AI：Anthropic Claude API
