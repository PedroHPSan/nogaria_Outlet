// Feedback tátil/sonoro no scan contínuo (celular). Tudo best-effort: sem suporte, não faz nada.
let ctx = null;
const beep = (freq, ms) => {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + ms / 1000);
  } catch { /* sem áudio */ }
};

export function feedback(tom) {
  const ok = tom === "ok";
  try { navigator.vibrate?.(ok ? 40 : [60, 40, 60]); } catch { /* sem vibração */ }
  beep(ok ? 880 : 220, ok ? 120 : 250);
}
