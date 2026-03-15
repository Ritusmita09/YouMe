"use client";

import { useEffect, useMemo, useState } from "react";

const FOCUS_SECONDS = 25 * 60;
const BREAK_SECONDS = 5 * 60;

function formatClock(total) {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function HomePage() {
  const [phase, setPhase] = useState("focus");
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(FOCUS_SECONDS);
  const [habits, setHabits] = useState([]);
  const [newHabit, setNewHabit] = useState("");

  const phaseLabel = useMemo(() => (phase === "focus" ? "Focus" : "Break"), [phase]);

  useEffect(() => {
    const raw = localStorage.getItem("youme-online-habits");
    if (raw) {
      try {
        setHabits(JSON.parse(raw));
      } catch (_) {
        setHabits([]);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("youme-online-habits", JSON.stringify(habits));
  }, [habits]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setRemaining((prev) => {
        if (prev > 1) return prev - 1;
        if (phase === "focus") {
          setPhase("break");
          return BREAK_SECONDS;
        }
        setPhase("focus");
        return FOCUS_SECONDS;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [running, phase]);

  function resetTimer() {
    setRunning(false);
    setPhase("focus");
    setRemaining(FOCUS_SECONDS);
  }

  function addHabit() {
    const value = newHabit.trim();
    if (!value) return;
    setHabits((prev) => [
      ...prev,
      { id: crypto.randomUUID(), title: value, done: false },
    ]);
    setNewHabit("");
  }

  function toggleHabit(id) {
    setHabits((prev) =>
      prev.map((h) => (h.id === id ? { ...h, done: !h.done } : h))
    );
  }

  function removeHabit(id) {
    setHabits((prev) => prev.filter((h) => h.id !== id));
  }

  return (
    <main className="page">
      <section className="hero">
        <p className="kicker">YouMe Online</p>
        <h1>Cloud Build for Vercel</h1>
        <p>
          This version excludes all YouTube downloading and server-side media extraction.
          It focuses on lightweight productivity features for online hosting.
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <h2>Pomodoro</h2>
          <div className="timer">{formatClock(remaining)}</div>
          <p className="badge">{phaseLabel} phase</p>
          <div className="row">
            <button onClick={() => setRunning((v) => !v)}>
              {running ? "Pause" : "Start"}
            </button>
            <button className="ghost" onClick={resetTimer}>Reset</button>
          </div>
        </article>

        <article className="card">
          <h2>Habit Tracker</h2>
          <div className="row">
            <input
              value={newHabit}
              onChange={(e) => setNewHabit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addHabit();
              }}
              placeholder="Add a new habit"
            />
            <button onClick={addHabit}>Add</button>
          </div>
          <ul className="list">
            {habits.length === 0 && <li className="muted">No habits yet.</li>}
            {habits.map((habit) => (
              <li key={habit.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={habit.done}
                    onChange={() => toggleHabit(habit.id)}
                  />
                  <span className={habit.done ? "done" : ""}>{habit.title}</span>
                </label>
                <button className="small ghost" onClick={() => removeHabit(habit.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="note card">
        <h2>Why this split?</h2>
        <p>
          Offline build (Flask) remains available for localhost workflows including yt-dlp.
          Online build (Next.js) is optimized for Vercel and intentionally avoids YouTube download features.
        </p>
      </section>
    </main>
  );
}
