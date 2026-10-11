const RELEASES = 'https://github.com/mchl-schrdng/dwell-terminal/releases/download';
const API = 'https://api.github.com/repos/mchl-schrdng/dwell-terminal/releases/latest';

function versionParts(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))
    throw new Error('Invalid release version.');
  const parts = value.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Invalid release version.');
  return parts;
}

async function checkForUpdates(currentVersion) {
  const current = versionParts(currentVersion);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Dwell' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error('Could not check for updates.');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 256 * 1024) throw new Error('Release metadata is too large.');
      chunks.push(chunk);
    }
    const release = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!release || typeof release !== 'object') throw new Error('Invalid release metadata.');
    if (release.draft === true || release.prerelease === true) return null;
    if (release.draft !== false || release.prerelease !== false)
      throw new Error('Invalid release metadata.');
    const version =
      typeof release.tag_name === 'string' && release.tag_name.startsWith('v')
        ? release.tag_name.slice(1)
        : null;
    const latest = versionParts(version);
    const changed = latest.findIndex((part, index) => part !== current[index]);
    if (changed === -1 || latest[changed] < current[changed]) return null;
    const name = `Dwell-${version}-macos-arm64.zip`;
    const url = `${RELEASES}/v${version}/${name}`;
    const asset =
      Array.isArray(release.assets) && release.assets.find((item) => item?.name === name);
    if (
      !asset ||
      asset.state !== 'uploaded' ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      asset.browser_download_url !== url
    )
      throw new Error('The release download is not ready.');
    return { version, url };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

module.exports = { checkForUpdates };
