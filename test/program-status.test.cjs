const test = require('node:test');
const assert = require('node:assert/strict');
const { PROGRAM_STATUS_REPLY, parseProgramStatus } = require('../src/program-status.cjs');
const encoded = (text) => Buffer.from(text).toString('base64');

test('program status detects support with a fixed reply and keeps only semantic fields', () => {
  assert.deepEqual(parseProgramStatus('?'), { query: true });
  assert.equal(
    PROGRAM_STATUS_REPLY,
    '\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\',
  );
  for (const state of ['idle', 'working', 'done', 'blocked', 'error', 'clear'])
    assert.deepEqual(parseProgramStatus(`state=${state}`), { state, id: '', kind: undefined });
  for (const kind of ['permission', 'question', 'auth']) {
    assert.deepEqual(
      parseProgramStatus(
        `state=blocked:kind=${kind}:app=claude-code:progress=80:msg=${encoded('Private message')}:title=${encoded('Private title')}`,
      ),
      { state: 'blocked', id: '', kind },
    );
    assert.equal(parseProgramStatus(`state=working:kind=${kind}`).kind, undefined);
  }
  assert.equal(parseProgramStatus('state=blocked:kind=future').kind, undefined);
  for (const value of [null, undefined, 3, {}, '', ' ? ', '? ', 'kind=auth', 'state=future'])
    assert.equal(parseProgramStatus(value), null);
});

test('unknown and malformed pairs do not erase valid state; the last valid duplicate wins', () => {
  assert.deepEqual(
    parseProgramStatus(
      'state=error:state=working:state=not valid:BAD=ignored:missing:=empty:extra=ignored: kind = question :state=blocked',
    ),
    { state: 'blocked', id: '', kind: 'question' },
  );
  assert.deepEqual(parseProgramStatus('state=blocked:kind=auth:kind=future'), {
    state: 'blocked',
    id: '',
    kind: undefined,
  });
  assert.equal(parseProgramStatus('state=working:state=future'), null);
  assert.equal(parseProgramStatus('state=working:state='), null);
  assert.deepEqual(parseProgramStatus('state=working:unknown=not valid:extra=%'), {
    state: 'working',
    id: '',
    kind: undefined,
  });
});

test('child identities stay distinct from the root and respect all path limits', () => {
  const id = 'Build_1/test+linux/unit.2';
  assert.deepEqual(parseProgramStatus(`state=working:id=${id}`), {
    state: 'working',
    id,
    kind: undefined,
  });
  assert.deepEqual(parseProgramStatus('state=clear:id=build/test'), {
    state: 'clear',
    id: 'build/test',
    kind: undefined,
  });
  for (const id of [
    '',
    '/',
    '/a',
    'a/',
    'a//b',
    'a,b',
    'a=b',
    'a@b',
    'a b',
    'é',
    'a'.repeat(33),
    Array(9).fill('a').join('/'),
  ])
    assert.equal(parseProgramStatus(`state=working:id=${id}`), null, id);
  const maxId = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32), 'd'.repeat(29)].join('/');
  assert.equal(maxId.length, 128);
  assert.equal(parseProgramStatus(`state=working:id=${maxId}`).id, maxId);
  assert.equal(parseProgramStatus(`state=working:id=${maxId}d`), null);
  assert.equal(
    parseProgramStatus(`state=working:id=${Array(8).fill('a').join('/')}`).state,
    'working',
  );
  assert.equal(parseProgramStatus('state=working:id=old:id=new').id, 'new');
  assert.equal(parseProgramStatus('state=working:id=bad@id:id=new'), null);
  assert.equal(parseProgramStatus(`state=working:id=${'a'.repeat(33)}:id=new`), null);
});

test('text must be canonical base64 with valid UTF-8 and no control characters', () => {
  for (const text of ['', 'Ready', 'Été — 準備完了 🌙']) {
    const value = encoded(text);
    for (const base64 of [value, value.replace(/=+$/, '')])
      assert.equal(parseProgramStatus(`state=done:msg=${base64}:title=${base64}`).state, 'done');
  }
  for (const value of ['A', 'AA=', 'AB==', '=QQ', 'QQ===', 'QQ==QQ', 'QQ_', 'QQ-', 'a,b'])
    assert.equal(parseProgramStatus(`state=done:msg=${value}`), null, value);
  for (const key of ['msg', 'title'])
    for (const value of ['bad@', '%', 'not valid']) {
      assert.equal(parseProgramStatus(`state=working:${key}=${value}`), null);
      assert.equal(
        parseProgramStatus(`state=working:${key}=${value}:${key}=${encoded('Valid')}`),
        null,
      );
    }
  for (const bytes of [[0xc0, 0x80], [0xff], [0xed, 0xa0, 0x80]])
    assert.equal(
      parseProgramStatus(`state=done:title=${Buffer.from(bytes).toString('base64')}`),
      null,
    );
  for (const codepoint of [0, 9, 10, 13, 27, 31, 127, 128, 159])
    for (const key of ['msg', 'title'])
      assert.equal(
        parseProgramStatus(`state=done:${key}=${encoded(String.fromCodePoint(codepoint))}`),
        null,
      );
  assert.equal(parseProgramStatus(`state=done:msg=${encoded('\n')}:msg=${encoded('Ready')}`), null);
});

test('limits discard the whole report before duplicate or unknown fields can hide excess', () => {
  const report = 'state=working:unknown=';
  assert.equal(parseProgramStatus(report + 'a'.repeat(4087 - report.length)).state, 'working');
  assert.equal(parseProgramStatus(report + 'a'.repeat(4088 - report.length)), null);
  assert.equal(parseProgramStatus('state=working:' + 'a'.repeat(17) + '=1'), null);
  assert.equal(parseProgramStatus(`state=working:app=${'a'.repeat(32)}`).state, 'working');
  assert.equal(parseProgramStatus(`state=working:app=${'a'.repeat(33)}:app=ok`), null);
  assert.equal(parseProgramStatus(`state=working:app=${'é'.repeat(17)}:app=ok`), null);
  for (const [key, size] of [
    ['msg', 2048],
    ['title', 192],
  ]) {
    assert.equal(
      parseProgramStatus(`state=done:${key}=${encoded('a'.repeat(size))}`).state,
      'done',
    );
    assert.equal(parseProgramStatus(`state=done:${key}=${encoded('a'.repeat(size + 1))}`), null);
    assert.equal(
      parseProgramStatus(`state=done:${key}=${encoded('a'.repeat(size + 1))}:${key}=`),
      null,
    );
  }
  assert.equal(parseProgramStatus(`state=done:msg=${' '.repeat(2)}${'%'.repeat(2733)}:msg=`), null);
  // Multibyte text is limited by bytes, not displayed character count.
  assert.equal(parseProgramStatus(`state=done:title=${encoded('é'.repeat(96))}`).state, 'done');
  assert.equal(parseProgramStatus(`state=done:title=${encoded('é'.repeat(97))}`), null);
});
