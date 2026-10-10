const button = document.querySelector('#orb');
const canvas = document.querySelector('#orb-dust');
const context = canvas.getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const forcedColors = matchMedia('(forced-colors: active)');
const particles = Array.from({ length: 180 }, (_, index) => {
  const fraction = (value) => value - Math.floor(value);
  const z = fraction(index * 0.754877666) * 2 - 1;
  const angle = index * 2.39996323;
  const radius = 8 + Math.sqrt(fraction(index * 0.569840291)) * 19;
  const ring = Math.sqrt(1 - z * z) * radius;
  return {
    x: Math.cos(angle) * ring,
    y: Math.sin(angle) * ring,
    z: z * radius,
    phase: angle,
    size: 0.35 + fraction(index * 0.438579) * 0.55,
  };
});
let count = 0;
let energy = 0;
let time = 0;
let lastFrame = 0;
let frame;
const color = [178, 192, 215];
const palettes = [
  [178, 192, 215],
  [235, 194, 128],
  [239, 158, 131],
];

function draw(delta) {
  const level = Math.min(count, 2);
  const blend = reducedMotion.matches ? 1 : 1 - Math.exp(-delta * 2.3);
  energy += (level - energy) * blend;
  for (let i = 0; i < color.length; i++) color[i] += (palettes[level][i] - color[i]) * blend;
  time += delta * (0.15 + energy * 0.13);
  const turn = reducedMotion.matches ? 0 : time;
  const cosine = Math.cos(turn);
  const sine = Math.sin(turn);
  const breathe = 1 + Math.sin(turn * 2.1) * (0.035 + energy * 0.02);
  context.clearRect(0, 0, 88, 88);
  context.fillStyle = `rgb(${color.join(' ')})`;
  for (const particle of particles) {
    const depth = particle.x * sine + particle.z * cosine;
    const flow = reducedMotion.matches ? 0 : Math.sin(turn * 1.7 + particle.phase) * (2 + energy);
    const x = 44 + (particle.x * cosine - particle.z * sine) * breathe + flow;
    const y = 44 + (particle.y + Math.sin(turn + particle.phase) * 2) * breathe;
    const size = particle.size * (1 + (depth + 27) / 85);
    const opacity = 0.22 + ((depth + 27) / 54) * 0.58;
    context.globalAlpha = opacity * 0.08;
    context.beginPath();
    context.arc(x, y, size * 3.5, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = opacity;
    context.beginPath();
    context.arc(x, y, size, 0, Math.PI * 2);
    context.fill();
  }
}

function animate(now) {
  if (now - lastFrame >= 1000 / 30 - 1) {
    draw(Math.min((now - lastFrame) / 1000, 0.1));
    lastFrame = now;
  }
  frame = requestAnimationFrame(animate);
}

function refresh() {
  cancelAnimationFrame(frame);
  const scale = Math.min(devicePixelRatio || 1, 2);
  canvas.width = canvas.height = Math.round(88 * scale);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  draw(0);
  if (!document.hidden && !reducedMotion.matches && !forcedColors.matches) {
    lastFrame = performance.now();
    frame = requestAnimationFrame(animate);
  }
}
reducedMotion.addEventListener('change', refresh);
forcedColors.addEventListener('change', refresh);
document.addEventListener('visibilitychange', refresh);
window.addEventListener('resize', refresh);
refresh();

let start;
let moved = false;
window.orb.onState((state) => {
  const { label } = state;
  count = state.count;
  button.classList.toggle('attention', count > 0);
  document.querySelector('#orb-core').textContent = count ? '!' : '·';
  const badge = document.querySelector('#orb-count');
  badge.hidden = count < 2;
  badge.textContent = count;
  const title = count ? `${label} needs attention (${count})` : 'Open Dwell';
  button.setAttribute('aria-label', title);
  button.title = `${title} · Drag to move · Right-click to hide`;
  if (reducedMotion.matches) draw(0);
});
button.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  start = { x: event.screenX, y: event.screenY };
  moved = false;
  button.setPointerCapture(event.pointerId);
  window.orb.drag('start');
});
button.addEventListener('pointermove', (event) => {
  if (!start) return;
  if (Math.hypot(event.screenX - start.x, event.screenY - start.y) > 4) moved = true;
  if (moved) window.orb.drag('move');
});
button.addEventListener('lostpointercapture', () => {
  start = null;
  window.orb.drag('end');
});
button.addEventListener('click', () => {
  if (!moved) window.orb.open();
});
button.addEventListener('keydown', () => {
  moved = false;
});
