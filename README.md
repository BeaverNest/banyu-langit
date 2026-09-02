# Banyu Langit

IDX market analytics & trading diary — Bloomberg-style terminal for Indonesian stock market.

## Features

- **Trading Diary** — Log trades with screenshots, tags, and P&L tracking
- **Watchlist** — Track stocks with real-time Yahoo Finance prices
- **Market Dashboard** — IHSG indices, sectoral performance, market breadth
- **Insider Ownership** — Track insider transactions & ownership changes
- **Stock Screener** — Filter IDX stocks by fundamentals & technicals
- **Backtest** — Test trading strategies against historical data
- **Portfolio** — Track holdings, allocation, and performance
- **IDX Data** — Sync IDX-API data (daily prices, top gainers/losers, foreign flow)

## Stack

| Layer | Tech |
|-------|------|
| Backend | Node.js + Express |
| Database | SQLite (better-sqlite3) |
| Frontend | Vanilla HTML/CSS/JS |
| Data | Yahoo Finance, IDX-API |
| Container | Docker + Docker Compose |

## Quick Start

### Local

```bash
npm install
node server/index.js
# Open http://localhost:3000
```

### Docker

```bash
docker compose up -d
# Open http://localhost:3003
```

## Environment

Create `.env`:

```env
PORT=3000
API_KEY=           # Optional: protect API with key
LOG_LEVEL=info
```

## API Routes

| Route | Description |
|-------|-------------|
| `GET /api/diary` | List diary entries |
| `POST /api/diary` | Create diary entry |
| `GET /api/watchlist` | Get watchlist |
| `GET /api/market` | Market overview |
| `GET /api/insider` | Insider transactions |
| `GET /api/idx` | IDX daily data |
| `GET /api/screener` | Stock screener |
| `GET /api/backtest` | Backtest strategies |
| `GET /api/portfolio` | Portfolio tracker |
| `GET /api/ticker/:code` | Unified ticker lookup |

## Project Structure

```
banyu-langit/
├── server/
│   ├── index.js        # Express app + route mounting
│   ├── db.js           # SQLite setup & helpers
│   ├── routes/         # API route handlers
│   └── utils/          # Yahoo Finance, IDX bridge, news
├── public/
│   ├── index.html      # Main UI
│   ├── chart-popup.html
│   ├── css/
│   └── js/
├── data/               # SQLite database files
├── uploads/            # Diary screenshots
├── Dockerfile
└── docker-compose.yml
```

## License

Private — BeaverNest internal use.
