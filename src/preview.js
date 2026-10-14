import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { node } from './ui.js';

const languages = {
  js: 'javascript',
  jsx: 'javascript',
  cjs: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  yml: 'yaml',
  md: 'markdown',
  sh: 'bash',
  zsh: 'bash',
  h: 'c',
  hpp: 'cpp',
  vue: 'xml',
  svelte: 'xml',
  svg: 'xml',
  html: 'xml',
};
export function renderCode(text, extension, wrap) {
  const ext = extension?.replace('.', '') || '';
  const language = languages[ext] || ext;
  const source = node('div');
  if (text.length < 120000 && hljs.getLanguage(language))
    source.innerHTML = hljs.highlight(text, { language, ignoreIllegals: true }).value;
  else source.textContent = text;
  const lines = [document.createDocumentFragment()];
  // Split highlighted DOM at newlines while preserving nested syntax spans.
  function collect(element, ancestors = []) {
    if (element.nodeType === Node.TEXT_NODE) {
      element.textContent.split('\n').forEach((part, index) => {
        if (index) lines.push(document.createDocumentFragment());
        let leaf = document.createTextNode(part);
        for (let i = ancestors.length - 1; i >= 0; i--) {
          const wrapper = ancestors[i].cloneNode(false);
          wrapper.append(leaf);
          leaf = wrapper;
        }
        lines.at(-1).append(leaf);
      });
    } else
      for (const child of element.childNodes)
        collect(child, element === source ? ancestors : [...ancestors, element]);
  }
  collect(source);
  const view = node('div', 'code-lines' + (wrap ? ' wrap' : ''));
  lines.forEach((content, index) => {
    const line = node('div', 'source-line');
    const number = node('span', 'source-number', String(index + 1));
    number.setAttribute('aria-hidden', 'true');
    const code = node('span', 'source-text');
    code.append(content);
    if (!code.textContent) code.append(document.createTextNode(' '));
    line.append(number, code);
    view.append(line);
  });
  return view;
}

export function renderMarkdown(text, openLink) {
  const markdown = node('article', 'markdown');
  markdown.innerHTML = DOMPurify.sanitize(marked.parse(text, { gfm: true }), {
    ALLOWED_TAGS: [
      'p',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'pre',
      'code',
      'blockquote',
      'strong',
      'em',
      'del',
      'br',
      'hr',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'a',
    ],
    ALLOWED_ATTR: ['href', 'title', 'start'],
    ALLOW_DATA_ATTR: false,
  });
  markdown.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (link) {
      event.preventDefault();
      openLink(link.getAttribute('href'));
    }
  });
  return markdown;
}

export function renderDiff(diff) {
  const view = node('div', 'diff-view');
  if (!diff.sections.length) {
    view.append(node('div', 'empty-state', diff.reason || 'No changes in this file.'));
    return view;
  }
  for (const section of diff.sections) {
    view.append(node('h3', 'diff-heading', section.label));
    const code = node('div', 'diff-code');
    let inHunk = section.label === 'Untracked';
    for (const line of section.text.split('\n')) {
      if (line.startsWith('@@')) inHunk = true;
      const kind =
        !inHunk && (line.startsWith('+++') || line.startsWith('---'))
          ? 'meta'
          : line.startsWith('+')
            ? 'added'
            : line.startsWith('-')
              ? 'removed'
              : line.startsWith('@@')
                ? 'hunk'
                : '';
      code.append(node('div', 'diff-line ' + kind, line || ' '));
    }
    view.append(code);
  }
  return view;
}

export function selectionContext(container, file, relativePath, selection = window.getSelection()) {
  if (
    !file ||
    typeof relativePath !== 'string' ||
    !relativePath ||
    !selection ||
    selection.rangeCount !== 1 ||
    selection.isCollapsed
  )
    return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer))
    return null;
  function selectedText(element) {
    if (!range.intersectsNode(element)) return '';
    const part = document.createRange();
    part.selectNodeContents(element);
    if (part.compareBoundaryPoints(Range.START_TO_START, range) < 0)
      part.setStart(range.startContainer, range.startOffset);
    if (part.compareBoundaryPoints(Range.END_TO_END, range) > 0)
      part.setEnd(range.endContainer, range.endOffset);
    return part.toString();
  }
  let location;
  let excerpt;
  const source = [...container.querySelectorAll('.source-text')];
  if (source.length && typeof file.text === 'string') {
    const selected = source.flatMap((line, index) => (selectedText(line) ? [index] : []));
    if (!selected.length) return null;
    const first = selected[0];
    const last = selected.at(-1);
    location = first === last ? `line ${first + 1}` : `lines ${first + 1}–${last + 1}`;
    excerpt = file.text
      .split('\n')
      .slice(first, last + 1)
      .join('\n');
  } else if (file.kind === 'markdown') {
    const markdown = container.querySelector('.markdown');
    if (!markdown) return null;
    location = 'rendered Markdown';
    excerpt = selection.toString();
  } else if (file.kind === 'diff') {
    location = 'diff';
    const sections = [...container.querySelectorAll('.diff-code')].flatMap((code, index) => {
      const selected = [...code.children].flatMap((line, number) =>
        selectedText(line) ? [number] : [],
      );
      if (!selected.length) return [];
      const section = file.sections[index];
      const lines = section.text.split('\n');
      const first = selected[0];
      const hunk = lines[first].startsWith('@@')
        ? null
        : lines.slice(0, first).findLast((line) => line.startsWith('@@'));
      const excerpt = lines.slice(first, selected.at(-1) + 1).join('\n');
      return [`${section.label}\n${hunk ? hunk + '\n' : ''}${excerpt}`];
    });
    excerpt = sections.join('\n\n');
  } else return null;
  if (!excerpt.trim()) return null;
  const bytes = new TextEncoder().encode(excerpt);
  if (bytes.length > 32768)
    excerpt =
      new TextDecoder().decode(bytes.subarray(0, 32768), { stream: true }) +
      '\n[Selection truncated]';
  return `About ${JSON.stringify(relativePath)} (${location}):\n\n${excerpt}\n\n`;
}
