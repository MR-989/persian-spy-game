# Persian Spy Game — بازی جاسوس فارسی

Real-time multiplayer Persian (Farsi, RTL) spy game.
Frontend: React + Vite. Backend: Node.js + Express + Socket.IO.

## Rules
- Minimum 3 players.
- 3–7 players = 1 spy. 8+ players = 2 spies.
- Normal players all see the same secret Persian word; spies see only «جاسوس».
- Every player presses «دیدم». The timer starts only after **all** players have pressed it.
- When the timer ends, voting begins. Players vote for the suspected spy.
- If a spy is among the most-voted, the players win — otherwise the spies win.
- Each player only ever receives their own role/word (roles are never broadcast).

## Run locally
```bash
npm run install:all      # installs server + client deps
npm run dev              # runs both (server :4000, client :5173)
```
Client: http://localhost:5173 — Server: http://localhost:4000

## Environment variables
Backend (`server/.env`):
```
PORT=4000                                  # host usually provides this
FRONTEND_ORIGIN=https://your-frontend-url  # comma-separated list allowed; localhost:5173 always allowed
```
Frontend (`client/.env`):
```
VITE_SERVER_URL=https://your-backend-url   # no trailing slash
```

## Production build
```bash
# backend
cd server && npm install && npm start
# frontend (outputs to client/dist)
cd client && npm install && npm run build
```

## Health check
`GET /health` → `{ "ok": true, "service": "persian-spy-game" }`

## Deploy
See `DEPLOY.md`. A one-file Render blueprint (`render.yaml`) deploys both
the backend (web service) and frontend (static site) together.
