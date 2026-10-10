// Deliberately require a path separator or extension; times, URLs and bare names are not files.
function references(text) {
  if (typeof text !== 'string' || text.length > 32768) return [];
  const pattern =
    /(?:"([^"\n]+)"|'([^'\n]+)'|([^:\s"'<>|()[\]{}]+)):(\d{1,7})(?::(\d{1,7}))?(?![\d:])/gu;
  const results = [];
  for (const match of text.matchAll(pattern)) {
    if (match.index > 0 && !/[\s([{'"]/.test(text[match.index - 1])) continue;
    const filename = match[1] || match[2] || match[3];
    const line = Number(match[4]);
    const column = Number(match[5] || 1);
    if (
      !line ||
      !column ||
      filename.includes(':') ||
      !/[/.]/.test(filename) ||
      filename.length > 4096 ||
      [...filename].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
      continue;
    results.push({
      path: filename,
      line,
      column,
      index: match.index,
      length: match[0].length,
      text: match[0],
    });
    if (results.length === 32) break;
  }
  return results;
}

module.exports = { references };
