#!/usr/bin/env node
// Exercise terminal feature detection and reports through a real foreground PTY.
const assert = require('node:assert/strict');
const osc = (body) => process.stdout.write(`\x1b]7501;${body}\x1b\\`);
const report = (state, extra = '') => osc(`state=${state}:app=claude-code${extra}`);
let ready = false;
let input = '';
const timer = setTimeout(() => {
  console.error('STATUS_HANDSHAKE_TIMEOUT');
  process.exit(1);
}, 5000);
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', (data) => {
  input += data.toString('utf8');
  if (!ready) {
    // eslint-disable-next-line no-control-regex -- Match the real terminal response bytes.
    const da = input.match(/\x1b\[\??[0-9;]*c/);
    if (!da) return;
    // eslint-disable-next-line no-control-regex -- Match the real terminal response bytes.
    const reply = input.match(/\x1b\]7501;([^\x07\x1b]*)(?:\x07|\x1b\\)/);
    assert(reply, 'the terminal must advertise native program status');
    assert(reply.index < da.index, 'program status reply must arrive before device attributes');
    assert.equal(
      reply[1],
      '?:states=idle,working,done,blocked,error:kinds=permission,question,auth',
    );
    clearTimeout(timer);
    ready = true;
    input = '';
    console.log('STATUS_HANDSHAKE_BEFORE_DA');
    return;
  }
  let boundary;
  while ((boundary = input.search(/[\r\n]/)) >= 0) {
    const command = input.slice(0, boundary);
    input = input.slice(boundary + 1);
    if (!command) continue;
    if (['working', 'done', 'error', 'idle', 'clear'].includes(command)) report(command);
    else if (['permission', 'question', 'auth'].includes(command))
      report('blocked', ':kind=' + command);
    else if (command === 'legacy-idle') process.stdout.write('\x1b]9;4;0\x07');
    else if (command === 'legacy-error') process.stdout.write('\x1b]9;4;2\x07');
    else if (command === 'bell-burst') process.stdout.write('\x07'.repeat(100));
    else if (command === 'native-burst')
      process.stdout.write('\x1b]7501;state=working:app=claude-code\x1b\\'.repeat(100));
    else if (command === 'invalid') report('error', ':msg=YQo=');
    else if (command === 'oversize') report('error', ':msg=' + 'a'.repeat(5000));
    else if (command.startsWith('forged '))
      report('working', ':cwd=' + Buffer.from(command.slice(7)).toString('base64'));
    else if (command === 'reset') process.stdout.write('\x1bc');
    else if (command === 'fast-done' || command === 'fast-error') {
      report(command.slice(5));
      process.exit(0);
    } else if (command === 'quit') process.exit(0);
    else throw new Error('Unknown status command: ' + command);
    console.log('STATUS_SENT:' + command);
  }
});
process.stdout.write('\x1b]7501;?\x1b\\\x1b[c');
