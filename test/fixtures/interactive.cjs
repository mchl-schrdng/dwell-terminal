// A deterministic full-screen terminal program; no account or network is needed.
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write('\x1b[?1049h\x1b[2J\x1b[HDwell terminal test\r\n');
let tick = 0;
const timer = setInterval(() => {
  process.stdout.write(`\x1b[3;1HBACKGROUND_TICK_${++tick}\x1b[K`);
}, 100);
process.stdin.on('data', (data) => {
  if (!data.includes(3) && !data.includes(4) && !data.includes(113)) return;
  clearInterval(timer);
  process.stdin.setRawMode(false);
  process.stdout.write('\x1b[?1049l');
  process.exit(0);
});
