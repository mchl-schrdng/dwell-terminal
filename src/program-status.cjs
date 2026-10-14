const PROGRAM_STATUS_REPLY =
  '\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\';
const states = new Set(['idle', 'working', 'done', 'blocked', 'error', 'clear']);
const kinds = new Set(['permission', 'question', 'auth']);

function validText(value, limit) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value, 'base64');
  const canonical = bytes.toString('base64');
  if (value !== canonical && value !== canonical.replace(/=+$/, '')) return false;
  if (bytes.length > limit) return false;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return ![...text].some((char) => {
      const code = char.codePointAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    });
  } catch {
    return false;
  }
}

function parseProgramStatus(data) {
  // Reserve nine bytes for OSC 7501; and the two-byte ST terminator.
  if (typeof data !== 'string' || Buffer.byteLength(data) > 4087) return null;
  if (data === '?') return { query: true };
  const fields = Object.create(null);
  for (const pair of data.split(':')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (Buffer.byteLength(key) > 16) return null;
    if (!/^[a-z]+$/.test(key)) continue;
    // Limits apply to every pair, including values replaced later in the report.
    if (key === 'app' && Buffer.byteLength(value) > 32) return null;
    if (key === 'id') {
      // A malformed child must never fall back to addressing the root record.
      if (
        value.length > 128 ||
        !/^[A-Za-z0-9_.+-]{1,32}(?:\/[A-Za-z0-9_.+-]{1,32}){0,7}$/.test(value)
      )
        return null;
    }
    if (key === 'msg' && Buffer.byteLength(value) > 2732) return null;
    if (key === 'title' && Buffer.byteLength(value) > 256) return null;
    if (key === 'msg' && !validText(value, 2048)) return null;
    if (key === 'title' && !validText(value, 192)) return null;
    if (!/^[A-Za-z0-9_.,+/=-]*$/.test(value)) continue;
    if (key === 'state' || key === 'id' || key === 'kind' || key === 'app') fields[key] = value;
  }
  const { state, kind } = fields;
  if (!states.has(state)) return null;
  const id = fields.id ?? '';
  return {
    state,
    id,
    kind: state === 'blocked' && kinds.has(kind) ? kind : undefined,
    ...(fields.app === undefined ? {} : { app: fields.app }),
  };
}

module.exports = { PROGRAM_STATUS_REPLY, parseProgramStatus };
