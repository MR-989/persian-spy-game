import express from "express";
import http from "http";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import { getRandomWord } from "./words.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;

// Build the list of allowed origins. FRONTEND_ORIGIN may be a single URL or a
// comma-separated list. Dev origins are always allowed. "*" allows everything.
const devOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];
const envOrigins = (process.env.FRONTEND_ORIGIN || "")
  .split(",")
  .map(o => o.trim())
  .filter(Boolean);
const allowAll = envOrigins.includes("*");
const allowedOrigins = [...new Set([...envOrigins.filter(o => o !== "*"), ...devOrigins])];

const corsOrigin = allowAll
  ? "*"
  : (origin, cb) => {
      // allow same-origin / curl / health checks (no Origin header)
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    };

const app = express();
app.use(cors({ origin: corsOrigin }));

app.get("/health", (_, res) => res.json({ ok: true, service: "persian-spy-game" }));

// --- Serve the built frontend (single-service deploy) ---
// After `npm run build` in the client, its output is copied to server/public.
const clientDist = path.join(__dirname, "public");
app.use(express.static(clientDist));
// SPA fallback: any non-API GET returns index.html (so refreshes work).
app.get(/^\/(?!health|socket\.io).*/, (_, res) => {
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) res.status(200).send("Persian Spy Game server is running. Frontend build not found yet.");
  });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowAll ? "*" : allowedOrigins, methods: ["GET", "POST"] },
  transports: ["websocket", "polling"]
});

const rooms = new Map();

const makeCode = () => Math.random().toString(36).substring(2, 7).toUpperCase();

const publicRoom = (room) => ({
  code: room.code,
  hostId: room.hostId,
  status: room.status,
  mode: room.mode,
  players: room.players.map(p => ({ id: p.id, name: p.name, isHost: p.id === room.hostId, seen: p.seen, voted: !!p.vote })),
  timer: room.timer,
  category: room.category,
  // Text mode: whose turn it is to ask, and who currently owes an answer.
  currentTurnId: room.mode === "text" && room.status === "playing" ? (room.turnOrder[room.turnIndex] || null) : null,
  pendingTo: room.mode === "text" && room.status === "playing" ? (room.pendingTo || null) : null,
  pendingFrom: room.mode === "text" && room.status === "playing" ? (room.pendingFrom || null) : null,
  messages: room.mode === "text" ? room.messages : [],
  secretWord: room.status === "result" ? room.secretWord : null,
  spies: room.status === "result" ? room.players.filter(p => p.role === "spy").map(p => ({ id: p.id, name: p.name })) : [],
  result: room.result || null
});

function emitRoom(room) {
  io.to(room.code).emit("room:update", publicRoom(room));
}

function findRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    const player = room.players.find(p => p.id === socketId);
    if (player) return { room, player };
  }
  return {};
}

function startCountdown(room) {
  if (room.countdown) clearInterval(room.countdown);
  room.status = "playing";
  room.timer = room.duration;
  emitRoom(room);
  room.countdown = setInterval(() => {
    room.timer -= 1;
    emitRoom(room);
    if (room.timer <= 0) {
      clearInterval(room.countdown);
      room.countdown = null;
      room.status = "voting";
      emitRoom(room);
    }
  }, 1000);
}

function maybeStartCountdown(room) {
  if (room.status === "reveal" && room.players.length && room.players.every(p => p.seen)) {
    startCountdown(room);
  }
}

function nameOf(room, id) {
  const p = room.players.find(x => x.id === id);
  return p ? p.name : "?";
}

// Move to the next still-connected player. Wraps and counts laps; when the
// configured number of laps is done, the asking phase ends and voting starts.
function advanceTurn(room) {
  room.pendingTo = null;
  room.pendingFrom = null;
  if (!room.turnOrder.length) return goToVoting(room);
  for (let step = 0; step < room.turnOrder.length; step++) {
    room.turnIndex += 1;
    if (room.turnIndex >= room.turnOrder.length) {
      room.turnIndex = 0;
      room.lap += 1;
      if (room.lap >= room.laps) return goToVoting(room);
    }
    const id = room.turnOrder[room.turnIndex];
    if (room.players.some(p => p.id === id)) { emitRoom(room); return; }
  }
  goToVoting(room);
}

function goToVoting(room) {
  if (room.countdown) clearInterval(room.countdown);
  room.countdown = null;
  room.status = "voting";
  emitRoom(room);
}

function calculateResult(room) {
  const counts = {};
  for (const p of room.players) if (p.vote) counts[p.vote] = (counts[p.vote] || 0) + 1;
  const values = Object.values(counts);
  const max = values.length ? Math.max(...values) : 0;
  const topIds = Object.keys(counts).filter(id => counts[id] === max);
  const spyIds = room.players.filter(p => p.role === "spy").map(p => p.id);
  const foundSpy = topIds.some(id => spyIds.includes(id));
  room.status = "result";
  room.result = foundSpy ? "players" : "spies";
  emitRoom(room);
}

function maybeFinishVoting(room) {
  if (room.status === "voting" && room.players.length && room.players.every(p => p.vote)) {
    calculateResult(room);
  }
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ name, duration = 180, category = "all", mode = "presential", laps = 1 }, cb) => {
    const code = makeCode();
    const room = {
      code,
      hostId: socket.id,
      status: "lobby",
      category,
      mode: mode === "text" ? "text" : "presential",
      laps: Math.max(1, Math.min(3, Number(laps) || 1)),
      duration: Number(duration) || 180,
      timer: Number(duration) || 180,
      secretWord: null,
      result: null,
      countdown: null,
      turnOrder: [],
      turnIndex: 0,
      lap: 0,
      pendingTo: null,
      pendingFrom: null,
      messages: [],
      players: [{ id: socket.id, name: name?.trim() || "بازیکن", role: null, seen: false, vote: null }]
    };
    rooms.set(code, room);
    socket.join(code);
    cb?.({ ok: true, room: publicRoom(room), playerId: socket.id });
    emitRoom(room);
  });

  socket.on("room:join", ({ code, name }, cb) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return cb?.({ ok: false, error: "اتاق پیدا نشد" });
    if (room.status !== "lobby") return cb?.({ ok: false, error: "بازی شروع شده است" });
    room.players.push({ id: socket.id, name: name?.trim() || "بازیکن", role: null, seen: false, vote: null });
    socket.join(room.code);
    cb?.({ ok: true, room: publicRoom(room), playerId: socket.id });
    emitRoom(room);
  });

  socket.on("game:start", (cb) => {
    const { room, player } = findRoomBySocket(socket.id);
    if (!room || !player) return cb?.({ ok: false, error: "اتاق پیدا نشد" });
    if (room.hostId !== socket.id) return cb?.({ ok: false, error: "فقط میزبان می‌تواند بازی را شروع کند" });
    if (room.players.length < 3) return cb?.({ ok: false, error: "حداقل ۳ بازیکن لازم است" });

    room.status = "reveal";
    room.secretWord = getRandomWord(room.category);
    room.result = null;
    room.messages = [];
    room.turnOrder = room.players.map(p => p.id); // join order = "بالترتیب"
    room.turnIndex = 0;
    room.lap = 0;
    room.pendingTo = null;
    room.pendingFrom = null;
    room.players.forEach(p => { p.role = "player"; p.seen = false; p.vote = null; });
    const spyCount = room.players.length > 7 ? 2 : 1;
    const shuffled = [...room.players].sort(() => Math.random() - 0.5);
    shuffled.slice(0, spyCount).forEach(p => p.role = "spy");

    // Send each player ONLY their own word/role over their private socket.
    for (const p of room.players) {
      io.to(p.id).emit("game:word", { word: p.role === "spy" ? "جاسوس" : room.secretWord, role: p.role });
    }
    cb?.({ ok: true });
    emitRoom(room);
  });

  socket.on("word:seen", () => {
    const { room, player } = findRoomBySocket(socket.id);
    if (!room || !player || room.status !== "reveal") return;
    player.seen = true;
    emitRoom(room);
    maybeStartCountdown(room);
  });

  socket.on("vote:cast", ({ targetId }, cb) => {
    const { room, player } = findRoomBySocket(socket.id);
    if (!room || !player || room.status !== "voting") return cb?.({ ok: false });
    if (!room.players.some(p => p.id === targetId)) return cb?.({ ok: false, error: "بازیکن نامعتبر" });
    player.vote = targetId;
    cb?.({ ok: true });
    emitRoom(room);
    maybeFinishVoting(room);
  });

  socket.on("turn:ask", ({ targetId, text }, cb) => {
    const { room, player } = findRoomBySocket(socket.id);
    if (!room || !player || room.mode !== "text" || room.status !== "playing") return cb?.({ ok: false });
    if (room.turnOrder[room.turnIndex] !== socket.id) return cb?.({ ok: false, error: "نوبت شما نیست" });
    if (room.pendingTo) return cb?.({ ok: false, error: "منتظر پاسخ بمانید" });
    const clean = String(text || "").trim().slice(0, 300);
    if (!clean) return cb?.({ ok: false, error: "سوال خالی است" });
    if (!room.players.some(p => p.id === targetId) || targetId === socket.id) return cb?.({ ok: false, error: "بازیکن نامعتبر" });
    room.messages.push({ type: "question", from: socket.id, fromName: player.name, to: targetId, toName: nameOf(room, targetId), text: clean, ts: Date.now() });
    room.pendingTo = targetId;
    room.pendingFrom = socket.id;
    cb?.({ ok: true });
    emitRoom(room);
  });

  socket.on("turn:answer", ({ text }, cb) => {
    const { room, player } = findRoomBySocket(socket.id);
    if (!room || !player || room.mode !== "text" || room.status !== "playing") return cb?.({ ok: false });
    if (room.pendingTo !== socket.id) return cb?.({ ok: false, error: "سوالی برای شما نیست" });
    const clean = String(text || "").trim().slice(0, 300);
    if (!clean) return cb?.({ ok: false, error: "پاسخ خالی است" });
    room.messages.push({ type: "answer", from: socket.id, fromName: player.name, to: room.pendingFrom, toName: nameOf(room, room.pendingFrom), text: clean, ts: Date.now() });
    cb?.({ ok: true });
    advanceTurn(room); // moves to next player, or starts voting after the last lap
  });

  socket.on("game:toVoting", () => {
    const { room } = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.status !== "playing") return;
    goToVoting(room);
  });

  socket.on("game:reset", () => {
    const { room } = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    if (room.countdown) clearInterval(room.countdown);
    room.countdown = null;
    room.status = "lobby";
    room.secretWord = null;
    room.result = null;
    room.timer = room.duration;
    room.messages = [];
    room.turnOrder = [];
    room.turnIndex = 0;
    room.lap = 0;
    room.pendingTo = null;
    room.pendingFrom = null;
    room.players.forEach(p => { p.role = null; p.seen = false; p.vote = null; });
    emitRoom(room);
  });

  socket.on("disconnect", () => {
    const { room } = findRoomBySocket(socket.id);
    if (!room) return;
    const wasTurn = room.mode === "text" && room.status === "playing" && room.turnOrder[room.turnIndex] === socket.id;
    const owedAnswer = room.pendingTo === socket.id;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (!room.players.length) {
      if (room.countdown) clearInterval(room.countdown);
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === socket.id) room.hostId = room.players[0].id;

    // Keep the turn pointer valid after someone leaves.
    if (room.mode === "text" && room.turnOrder.length) {
      const removedIdx = room.turnOrder.indexOf(socket.id);
      room.turnOrder = room.turnOrder.filter(id => id !== socket.id);
      if (removedIdx !== -1 && removedIdx < room.turnIndex) room.turnIndex -= 1;
      if (room.turnIndex >= room.turnOrder.length) room.turnIndex = 0;
    }
    emitRoom(room);

    if (room.status === "playing" && room.mode === "text" && (wasTurn || owedAnswer)) {
      // The person whose action we were waiting on is gone — move things along.
      room.pendingTo = null; room.pendingFrom = null;
      advanceTurn(room);
    }
    // A leaver could be the last person blocking the next phase.
    maybeStartCountdown(room);
    maybeFinishVoting(room);
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
