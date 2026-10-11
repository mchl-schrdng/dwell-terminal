const test = require('node:test');
const assert = require('node:assert/strict');
const { checkForUpdates } = require('../src/updates.cjs');

function release(version = '0.6.0') {
  const name = `Dwell-${version}-macos-arm64.zip`;
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        name,
        state: 'uploaded',
        size: 150000000,
        browser_download_url: `https://github.com/mchl-schrdng/dwell-terminal/releases/download/v${version}/${name}`,
      },
    ],
  };
}

test('checks the official release and returns only its Apple Silicon download', async (t) => {
  const metadata = release();
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/mchl-schrdng/dwell-terminal/releases/latest');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['User-Agent'], 'Dwell');
    return Response.json(metadata);
  });
  assert.deepEqual(await checkForUpdates('0.5.0'), {
    version: '0.6.0',
    url: metadata.assets[0].browser_download_url,
  });
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(fetch.mock.calls[0].arguments[1].signal.aborted, true);
});

test('compares numeric versions and never offers equal, older, draft or prerelease builds', async (t) => {
  let metadata;
  t.mock.method(globalThis, 'fetch', async () => Response.json(metadata));
  for (const [current, latest, available] of [
    ['0.5.0', '0.5.0', false],
    ['1.0.0', '0.99.99', false],
    ['0.10.0', '0.9.99', false],
    ['0.9.9', '0.10.0', true],
    ['0.5.0', '0.5.1', true],
    ['0.99.99', '1.0.0', true],
  ]) {
    metadata = release(latest);
    assert.equal((await checkForUpdates(current)) !== null, available);
  }
  for (const flag of ['draft', 'prerelease']) {
    metadata = { ...release(), [flag]: true };
    assert.equal(await checkForUpdates('0.5.0'), null);
  }
});

test('rejects malformed versions and untrusted or incomplete release assets', async (t) => {
  let metadata;
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(metadata));
  for (const version of [
    '0.6',
    '01.6.0',
    '0.6.0-beta.1',
    '0.6.0+build',
    '0.6.0\n',
    '9007199254740992.0.0',
    '../0.6.0',
    null,
  ]) {
    await assert.rejects(checkForUpdates(version), /version/);
    metadata = release(version);
    await assert.rejects(checkForUpdates('0.5.0'), /version/);
  }
  assert.equal(fetch.mock.callCount(), 8);
  for (const invalid of [
    null,
    [],
    {},
    { ...release(), draft: 'false' },
    { ...release(), tag_name: '0.6.0' },
  ]) {
    metadata = invalid;
    await assert.rejects(checkForUpdates('0.5.0'));
  }
  for (const patch of [
    { name: 'Dwell-0.6.0-macos-x64.zip' },
    { state: 'new' },
    { size: 0 },
    { size: '150000000' },
    { browser_download_url: 'https://example.com/Dwell-0.6.0-macos-arm64.zip' },
    { browser_download_url: `${release().assets[0].browser_download_url}?redirect=elsewhere` },
  ]) {
    metadata = release();
    Object.assign(metadata.assets[0], patch);
    await assert.rejects(checkForUpdates('0.5.0'), /download/);
  }
  for (const assets of [undefined, [], [null]]) {
    metadata = { ...release(), assets };
    await assert.rejects(checkForUpdates('0.5.0'), /download/);
  }
});

test('handles network, HTTP and malformed JSON failures without reporting an update', async (t) => {
  let response;
  t.mock.method(globalThis, 'fetch', async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  for (response of [
    new Error('offline'),
    new Response('rate limit', { status: 403 }),
    new Response('invalid JSON'),
  ])
    await assert.rejects(checkForUpdates('0.5.0'));
});

test('caps streamed metadata and cancels a response that exceeds the bound', async (t) => {
  let cancelled = false;
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(64 * 1024));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  await assert.rejects(checkForUpdates('0.5.0'), /too large/);
  assert.equal(cancelled, true);
});

test('times out an unresponsive request and a stalled response body', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let body = false;
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    if (!body)
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      );
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from('{'));
          signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        },
      }),
    );
  });
  for (body of [false, true]) {
    const pending = checkForUpdates('0.5.0');
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await Promise.resolve();
    t.mock.timers.tick(10000);
    await rejected;
  }
});
