// src/components/TaskDoneCelebration.jsx
// Global celebration modal: listens for the `task:done` event (fired from
// firebase.emitTaskDone whenever a task transitions to "done") and shows a
// confetti burst plus an encouraging message. Self-contained — canvas confetti,
// no external libraries. Honours prefers-reduced-motion.

import { useEffect, useRef, useState } from 'react';

const MESSAGES = [
  "You're doing great — keep the momentum going!",
  'Nice work! One down — ready for the next one?',
  'Boom! Another task done. You’re on a roll!',
  'Great job! Keep completing more tasks. 🚀',
];

/* ── canvas confetti ─────────────────────────────────────── */
function fireConfetti(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const resize = () => {
    canvas.width  = canvas.clientWidth  * dpr;
    canvas.height = canvas.clientHeight * dpr;
  };
  resize();

  const colors = ['#8b5cf6', '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899'];
  const W = canvas.width, H = canvas.height;
  const N = 160;
  const parts = Array.from({ length: N }, (_, i) => {
    const fromLeft = i % 2 === 0;
    return {
      x: fromLeft ? 0 : W,
      y: H * (0.5 + Math.sin(i) * 0.2),
      // shoot up and inward from the bottom corners
      vx: (fromLeft ? 1 : -1) * (6 + (i % 7)) * dpr,
      vy: -(9 + (i % 9)) * dpr,
      size: (5 + (i % 6)) * dpr,
      color: colors[i % colors.length],
      rot: i,
      vr: (i % 2 ? 1 : -1) * (0.12 + (i % 5) * 0.03),
      shape: i % 3,
    };
  });

  const gravity = 0.32 * dpr;
  const start = performance.now();
  const DURATION = 2600;
  let raf;

  const frame = (now) => {
    const t = now - start;
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    for (const p of parts) {
      p.vy += gravity;
      p.x  += p.vx;
      p.y  += p.vy;
      p.vx *= 0.99;
      p.rot += p.vr;
      const fade = Math.max(0, 1 - t / DURATION);
      if (p.y < H + 40 * dpr && fade > 0) alive = true;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 0)      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.5);
      else if (p.shape === 1) { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
      else                    ctx.fillRect(-p.size / 3, -p.size / 2, p.size * 0.66, p.size);
      ctx.restore();
    }
    if (alive && t < DURATION + 400) raf = requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, W, H);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

export default function TaskDoneCelebration() {
  const [open, setOpen]       = useState(false);
  const [message, setMessage] = useState(MESSAGES[0]);
  const canvasRef = useRef(null);
  const timerRef  = useRef(null);
  const seedRef   = useRef(0);

  // Subscribe to the global completion event.
  useEffect(() => {
    const onDone = () => {
      // Rotate the encouragement line without Math.random (kept deterministic-ish).
      seedRef.current = (seedRef.current + 1) % MESSAGES.length;
      setMessage(MESSAGES[seedRef.current]);
      setOpen(true);
    };
    window.addEventListener('task:done', onDone);
    return () => window.removeEventListener('task:done', onDone);
  }, []);

  // Fire confetti + auto-dismiss whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let stop;
    if (!reduce && canvasRef.current) stop = fireConfetti(canvasRef.current);
    timerRef.current = setTimeout(() => setOpen(false), 4200);
    return () => { stop?.(); clearTimeout(timerRef.current); };
  }, [open]);

  if (!open) return null;

  return (
    <div className="celebrate-backdrop" onClick={() => setOpen(false)}>
      <canvas ref={canvasRef} className="celebrate-canvas" />
      <div className="celebrate-card" onClick={(e) => e.stopPropagation()}>
        <div className="celebrate-emoji">🎉</div>
        <h3 className="celebrate-title">Task complete!</h3>
        <p className="celebrate-message">{message}</p>
        <button className="btn btn-primary celebrate-btn" onClick={() => setOpen(false)}>
          Keep going →
        </button>
      </div>
    </div>
  );
}
