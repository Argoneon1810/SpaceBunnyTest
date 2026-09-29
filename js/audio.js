/* Tiny WebAudio synth — no audio assets, no network, no libraries.
   The context is created lazily so autoplay policies stay happy. */

let ctx = null;
let master = null;
let wet = null;

function context() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();

  master = ctx.createGain();
  master.gain.value = 0.45;
  master.connect(ctx.destination);

  // Cheap ambience: two damped feedback delays standing in for a reverb.
  wet = ctx.createGain();
  wet.gain.value = 0.16;
  wet.connect(master);
  [0.13, 0.23].forEach((time, i) => {
    const delay = ctx.createDelay(1);
    delay.delayTime.value = time;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.34;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2400 - i * 900;
    delay.connect(damp).connect(feedback).connect(delay);
    delay.connect(wet);
    wet.__inputs = wet.__inputs || [];
    wet.__inputs.push(delay);
  });
  return ctx;
}

/** One enveloped oscillator voice, with a send into the delay network. */
function voice({ freq, at = 0, dur = 0.6, gain = 0.2, type = 'sine', detune = 0 }) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  const send = ctx.createGain();

  osc.type = type;
  osc.frequency.value = freq;
  osc.detune.value = detune;

  const t0 = ctx.currentTime + at;
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.014);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  send.gain.value = 0.45;
  osc.connect(env);
  env.connect(master);
  env.connect(send);
  for (const input of wet.__inputs) send.connect(input);

  osc.start(t0);
  osc.stop(t0 + dur + 0.06);
}

function play(fn) {
  const ac = context();
  if (!ac) return;
  if (ac.state === 'suspended') ac.resume();
  try {
    fn();
  } catch (err) {
    console.warn('[cadence] audio failed', err);
  }
}

const tri = (freq, at, dur, gain) => voice({ freq, at, dur, gain, type: 'triangle' });
const sin = (freq, at, dur, gain) => voice({ freq, at, dur, gain, type: 'sine' });

/** Rising major triad — a focus session finished. */
export function chimeFocus() {
  play(() => {
    [523.25, 659.25, 783.99].forEach((f, i) => tri(f, i * 0.09, 1.1, 0.15));
    sin(1046.5, 0.27, 1.5, 0.05);
  });
}

/** Falling soft pair — time to switch off. */
export function chimeBreak() {
  play(() => {
    [659.25, 493.88].forEach((f, i) => sin(f, i * 0.11, 0.8, 0.13));
  });
}

/** Neutral two-note blip for UI confirmations. */
export function blip(up = true) {
  play(() => {
    const base = up ? 440 : 392;
    voice({ freq: base, dur: 0.13, gain: 0.06, type: 'square' });
    voice({ freq: up ? base * 1.5 : base * 0.75, at: 0.055, dur: 0.16, gain: 0.045, type: 'square' });
  });
}
