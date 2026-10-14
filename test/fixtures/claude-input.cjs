// A foreground input recorder; no Claude account or network is needed.
const fs = require('node:fs');
const capture = process.argv[2];
const report = (state) => process.stdout.write(`\x1b]7501;state=${state}:app=claude-code\x1b\\`);
fs.writeFileSync(capture, '');
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', (data) => {
  fs.appendFileSync(capture, data);
  if (data.length !== 1) return;
  if (data[0] === 5) {
    report('clear');
    console.log('CLAUDE_INPUT_CLEAR');
  } else if (data[0] === 6) {
    report('working');
    console.log('CLAUDE_INPUT_REPORTED');
  } else if (data[0] === 4) {
    // Leave a stale report behind to exercise the independent foreground-shell check.
    process.stdout.write('\x1b[?2004l');
    process.stdin.setRawMode(false);
    process.exit(0);
  }
});
process.stdout.write('\x1b[?2004h');
if (process.argv[3] === 'unrelated') console.log('CLAUDE_INPUT_UNRELATED');
else {
  report('working');
  console.log('CLAUDE_INPUT_READY');
}
