// Original Eclipse chime: three gliding sine tones and one soft, filtered echo.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rate = 44100;
const frames = Math.round(rate * 1.05);
const left = new Float64Array(frames);
const right = new Float64Array(frames);
for (const [frequency, end, amplitude, duration, pan, delay] of [
  [310, 415, 0.16, 0.7, -0.32, 0],
  [832, 622, 0.085, 0.77, 0.33, 0.045],
  [1244, 1237, 0.028, 0.48, -0.15, 0.25],
]) {
  let phase = 0;
  const start = Math.round((0.015 + delay) * rate);
  for (let i = start; i < frames; i++) {
    const time = (i - start) / rate;
    if (time > duration + 0.03) break;
    const pitch = frequency * (end / frequency) ** Math.min(time / (duration * 0.7), 1);
    const envelope =
      time < 0.024
        ? amplitude * (time / 0.024)
        : amplitude * (0.0001 / amplitude) ** Math.min((time - 0.024) / (duration - 0.024), 1);
    const master = 0.3 * Math.exp(-Math.max(0, i / rate - 0.925) / 0.03);
    const sample = Math.sin(phase) * envelope * master;
    const angle = ((pan * (1 - 1.5 * Math.min(time / duration, 1)) + 1) * Math.PI) / 4;
    left[i] += sample * Math.cos(angle);
    right[i] += sample * Math.sin(angle);
    phase += (2 * Math.PI * pitch) / rate;
  }
}

// A 2.3 kHz low-pass filter softens the single 135 ms echo.
const omega = (2 * Math.PI * 2300) / rate;
const alpha = Math.sin(omega) / Math.SQRT2;
const a0 = 1 + alpha;
const b0 = (1 - Math.cos(omega)) / (2 * a0);
const b1 = 2 * b0;
const a1 = (-2 * Math.cos(omega)) / a0;
const a2 = (1 - alpha) / a0;
const delayFrames = Math.round(0.135 * rate);
const dry = Float64Array.from(left, (sample, i) => (sample + right[i]) / 2);
let x1 = 0;
let x2 = 0;
let y1 = 0;
let y2 = 0;
let peak = 0;
const pcm = Buffer.alloc(frames * 4);
for (let i = 0; i < frames; i++) {
  const input = i >= delayFrames ? dry[i - delayFrames] : 0;
  const echo = b0 * input + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
  [x2, x1, y2, y1] = [x1, input, y1, echo];
  left[i] += echo * 0.18 * Math.cos((1.45 * Math.PI) / 4);
  right[i] += echo * 0.18 * Math.sin((1.45 * Math.PI) / 4);
  for (const [channel, sample] of [left[i], right[i]].entries()) {
    assert(Number.isFinite(sample) && Math.abs(sample) < 1, 'sound must not clip');
    peak = Math.max(peak, Math.abs(sample));
    pcm.writeInt16LE(Math.round(sample * 32767), i * 4 + channel * 2);
  }
}
assert(peak > 0.02 && peak < 0.1, 'keep the chime audible but quiet');
const header = Buffer.alloc(44);
header.write('RIFF');
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(rate, 24);
header.writeUInt32LE(rate * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);
fs.writeFileSync(path.join(__dirname, '../src/orb-notification.wav'), Buffer.concat([header, pcm]));
console.log(
  `Eclipse chime: 1.05 s, stereo, ${rate} Hz, peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS`,
);
