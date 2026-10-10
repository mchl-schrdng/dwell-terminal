import {
  createIcons,
  Folder,
  PanelLeft,
  PanelRight,
  PanelsTopLeft,
  Scan,
  GitPullRequest,
  ChevronDown,
  ChevronRight,
  EyeOff,
  FileText,
  FileCode2,
  FileSearch,
  Link,
  Terminal as TerminalIcon,
  Code2,
  WrapText,
  X,
  Plus,
  ArrowDown,
  Image,
} from 'lucide';

export const $ = (selector) => document.querySelector(selector);
const icons = {
  Folder,
  PanelLeft,
  PanelRight,
  PanelsTopLeft,
  Scan,
  GitPullRequest,
  ChevronDown,
  ChevronRight,
  EyeOff,
  FileText,
  FileCode2,
  FileSearch,
  Link,
  Terminal: TerminalIcon,
  Code2,
  WrapText,
  X,
  Plus,
  ArrowDown,
  Image,
};
export const refreshIcons = () => createIcons({ icons, attrs: { 'aria-hidden': 'true' } });
export const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
export const icon = (name) => {
  const element = node('i');
  element.dataset.lucide = name;
  return element;
};
