import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DEFAULT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'checklist.md');

// Parses the upstream markdown checklist into sections of items.
export function parseChecklist(markdown) {
  const sections = [];
  let current = null;
  let n = 0;
  for (const line of markdown.split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      // Data Agent sections only make sense when a Data Agent already exists.
      const scope = /Data Agent Configuration|Testing and Validation/i.test(h[1]) ? 'dataagent' : 'model';
      current = { id: `s${sections.length + 1}`, title: h[1], scope, notes: [], items: [] };
      sections.push(current);
      continue;
    }
    const item = /^- \[ \]\s+(.*)$/.exec(line);
    if (item && current) {
      n += 1;
      const raw = item[1];
      current.items.push({
        id: `i${String(n).padStart(2, '0')}`,
        text: raw.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'),
        raw,
        critical: raw.includes('⚠️') || raw.includes('🚫'),
        links: [...raw.matchAll(/\]\((https?:[^)]+)\)/g)].map((m) => m[1]),
      });
      continue;
    }
    const note = /^\*\*(.+)\*\*\s*$/.exec(line);
    if (note && current) current.notes.push(note[1]);
  }
  return sections.filter((s) => s.items.length > 0);
}

export function loadChecklist(file = DEFAULT_FILE) {
  return parseChecklist(readFileSync(file, 'utf8'));
}
