import React, { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";

// In a single-service deploy the API + UI share one origin, so an empty URL
// makes socket.io connect back to the page's own host. In local dev we point
// at the standalone backend on :4000. An explicit VITE_SERVER_URL overrides both.
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? (import.meta.env.DEV ? "http://localhost:4000" : "");
const socket = io(SERVER_URL, { transports: ["websocket", "polling"] });

const categories = [
  ["all", "همه"], ["places", "مکان‌ها"], ["food", "غذاها"], ["objects", "اشیاء"],
  ["animals", "حیوانات"], ["jobs", "شغل‌ها"], ["sports", "ورزش"], ["transport", "وسایل نقلیه"],
  ["nature", "طبیعت"], ["tech", "فناوری"], ["events", "مناسبت‌ها"]
];

export default function App() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [duration, setDuration] = useState(180);
  const [category, setCategory] = useState("all");
  const [mode, setMode] = useState("presential");
  const [askText, setAskText] = useState("");
  const [askTarget, setAskTarget] = useState("");
  const [answerText, setAnswerText] = useState("");
  const [room, setRoom] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [myWord, setMyWord] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(socket.connected);

  const me = useMemo(() => room?.players?.find(p => p.id === playerId), [room, playerId]);
  const isHost = room?.hostId === playerId;

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onUpdate = (r) => {
      setRoom(r);
      // Clear the revealed word once we return to the lobby for a new round.
      if (r?.status === "lobby") { setMyWord(null); setRevealed(false); }
    };
    const onWord = ({ word }) => { setMyWord(word); setRevealed(false); };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:update", onUpdate);
    socket.on("game:word", onWord);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:update", onUpdate);
      socket.off("game:word", onWord);
    };
  }, []);

  const handleResponse = (res) => {
    if (!res?.ok) return setError(res?.error || "خطا رخ داد");
    setError(""); setRoom(res.room); setPlayerId(res.playerId);
  };
  const createRoom = () => socket.emit("room:create", { name, duration, category, mode }, handleResponse);
  const joinRoom = () => socket.emit("room:join", { name, code }, handleResponse);
  const startGame = () => socket.emit("game:start", res => !res?.ok && setError(res.error));
  const seenWord = () => socket.emit("word:seen");
  const vote = (id) => socket.emit("vote:cast", { targetId: id }, res => !res?.ok && setError(res.error));
  const reset = () => socket.emit("game:reset");
  const sendAsk = () => {
    if (!askTarget || !askText.trim()) return;
    socket.emit("turn:ask", { targetId: askTarget, text: askText }, res => {
      if (res?.ok) { setAskText(""); setAskTarget(""); } else setError(res?.error || "");
    });
  };
  const sendAnswer = () => {
    if (!answerText.trim()) return;
    socket.emit("turn:answer", { text: answerText }, res => {
      if (res?.ok) setAnswerText(""); else setError(res?.error || "");
    });
  };
  const forceVoting = () => socket.emit("game:toVoting");

  if (!room) return <main className="page"><section className="panel hero">
    <h1>بازی جاسوس فارسی</h1><p>اتاق بسازید یا با کد وارد شوید. یکی یا دو نفر جاسوس می‌شوند.</p>
    <input placeholder="نام بازیکن" value={name} onChange={e=>setName(e.target.value)} />
    <div className="row"><select value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(c=><option key={c[0]} value={c[0]}>{c[1]}</option>)}</select><input type="number" min="60" value={duration} onChange={e=>setDuration(e.target.value)} /></div>
    <div className="modes">
      <button className={mode==="presential"?"mode on":"mode"} onClick={()=>setMode("presential")}>حضوری (سوال‌ها رو در رو      )</button>
      <button className={mode==="text"?"mode on":"mode"} onClick={()=>setMode("text")}>آنلاین نوشتاری (نوبتی)</button>
    </div>
    <button onClick={createRoom} disabled={!connected}>ساخت اتاق</button>
    <div className="divider">یا</div>
    <input placeholder="کد اتاق" value={code} onChange={e=>setCode(e.target.value.toUpperCase())} />
    <button className="secondary" onClick={joinRoom} disabled={!connected}>ورود به اتاق</button>
    {!connected && <p className="muted">در حال اتصال به سرور…</p>}
    {error && <p className="error">{error}</p>}
  </section></main>;

  return <main className="page"><section className="panel">
    <div className="top"><h1>بازی جاسوس فارسی</h1><span className="badge">کد اتاق: {room.code}</span></div>
    {!connected && <p className="muted">ارتباط با سرور قطع شد، در حال اتصال مجدد…</p>}
    {error && <p className="error">{error}</p>}

    {room.status === "lobby" && <>
      <h2>اتاق انتظار</h2><PlayerList room={room}/>
      <p>تعداد بازیکنان: {room.players.length} / جاسوس‌ها: {room.players.length > 7 ? 2 : 1}</p>
      {isHost ? <button onClick={startGame}>شروع بازی</button> : <p>منتظر میزبان باشید...</p>}
    </>}

    {room.status === "reveal" && <>
      <h2>کلمه مخفی</h2>
      <div className={`card ${revealed ? "open" : ""}`} onClick={()=>setRevealed(true)}>
        {revealed ? myWord : "برای نمایش لمس کنید"}
      </div>
      {revealed && !me?.seen && <button onClick={seenWord}>دیدم</button>}
      <PlayerList room={room}/><p>بازی وقتی شروع می‌شود که همه «دیدم» را بزنند.</p>
    </>}

    {room.status === "playing" && room.mode !== "text" && <>
      <h2>سوال بپرسید و جاسوس را پیدا کنید</h2>
      <div className="timer">{Math.floor(room.timer/60)}:{String(room.timer%60).padStart(2,"0")}</div>
      <PlayerList room={room}/>
    </>}

    {room.status === "playing" && room.mode === "text" && (() => {
      const myTurn = room.currentTurnId === playerId;
      const iOweAnswer = room.pendingTo === playerId;
      const turnName = room.players.find(p=>p.id===room.currentTurnId)?.name || "";
      const others = room.players.filter(p => p.id !== playerId);
      return <>
        <h2>پرسش و پاسخ نوبتی</h2>
        <div className="chat">
          {room.messages.length === 0 && <p className="muted">هنوز سوالی پرسیده نشده.</p>}
          {room.messages.map((m,i) => (
            <div className={"msg "+(m.type)} key={i}>
              <b>{m.fromName}</b>{m.type==="question" ? <> ← {m.toName}</> : null}
              <span>{m.text}</span>
            </div>
          ))}
        </div>

        {iOweAnswer ? (
          <div className="turnbox">
            <p>به سوال پاسخ دهید:</p>
            <input value={answerText} onChange={e=>setAnswerText(e.target.value)} placeholder="پاسخ شما" />
            <button onClick={sendAnswer}>ارسال پاسخ</button>
          </div>
        ) : myTurn ? (
          <div className="turnbox">
            <p>نوبت شماست — یک نفر را انتخاب و سوال بپرسید:</p>
            <select value={askTarget} onChange={e=>setAskTarget(e.target.value)}>
              <option value="">— انتخاب بازیکن —</option>
              {others.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input value={askText} onChange={e=>setAskText(e.target.value)} placeholder="سوال شما" />
            <button onClick={sendAsk}>ارسال سوال</button>
          </div>
        ) : (
          <p className="muted">{room.pendingTo ? "در انتظار پاسخ…" : `نوبت ${turnName} است…`}</p>
        )}

        {isHost && <button className="secondary" onClick={forceVoting}>پایان و شروع رأی‌گیری</button>}
        <PlayerList room={room}/>
      </>;
    })()}

    {room.status === "voting" && <>
      <h2>رأی دادن</h2><p>به کسی که فکر می‌کنید جاسوس است رأی دهید.</p>
      <div className="grid">{room.players.map(p => <button key={p.id} disabled={me?.voted || p.id===playerId} onClick={()=>vote(p.id)}>{p.name}</button>)}</div>
      <PlayerList room={room}/>
    </>}

    {room.status === "result" && <>
      <h2>نتیجه بازی</h2>
      <div className="result">{room.result === "players" ? "بازیکنان برنده شدند" : "جاسوس‌ها برنده شدند"}</div>
      <p>کلمه: <b>{room.secretWord}</b></p>
      <p>جاسوس‌ها: <b>{room.spies.map(s=>s.name).join("، ")}</b></p>
      {isHost && <button onClick={reset}>بازی دوباره</button>}
    </>}
  </section></main>;
}

function PlayerList({ room }) {
  return <div className="players">{room.players.map(p => <div className="player" key={p.id}>
    <span>{p.name} {p.isHost ? "👑" : ""}</span><small>{p.seen ? "دیدم" : p.voted ? "رأی داد" : ""}</small>
  </div>)}</div>;
}
