#!/usr/bin/env node
/* Save a Google Drive export that came back through the Drive MCP tool
   (download_file_content) to a real file, without copying it by hand.

     node .claude/skills/lesa/fetch-export.mjs <driveFileId> <out-file>

   Claude Code keeps every tool result: large ones are written to
   tool-results/*.txt, small ones stay inside the session transcript
   (*.jsonl). This script finds the newest result for the file id in
   either place and writes the decoded bytes. It depends on Claude Code's
   local file layout, so it is a convenience for the /lesa skill only. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [fileId, out] = process.argv.slice(2);
if (!fileId || !out) {
  console.error('usage: fetch-export.mjs <driveFileId> <out-file>');
  process.exit(1);
}

const project = process.cwd().replace(/[:\\/ ]/g, '-');
const base = path.join(os.homedir(), '.claude', 'projects', project);
if (!fs.existsSync(base)) {
  console.error(`✖ no Claude Code session folder at ${base}`);
  process.exit(1);
}

const candidates = [];
for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
  const p = path.join(base, entry.name);
  if (entry.isFile() && entry.name.endsWith('.jsonl')) candidates.push(p);
  if (entry.isDirectory()) {
    const tr = path.join(p, 'tool-results');
    if (fs.existsSync(tr)) for (const f of fs.readdirSync(tr)) if (f.includes('download_file_content')) candidates.push(path.join(tr, f));
  }
}
candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

function fromJSON(text) {
  try {
    const j = JSON.parse(text);
    return j && j.id === fileId && typeof j.content === 'string' ? j : null;
  } catch { return null; }
}

function search(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (!file.endsWith('.jsonl')) return fromJSON(text);
  let found = null;
  for (const line of text.split('\n')) {
    if (!line.includes(fileId) || !line.includes('tool_result')) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    for (const block of rec?.message?.content || []) {
      if (block.type !== 'tool_result') continue;
      const parts = Array.isArray(block.content) ? block.content : [{ type: 'text', text: block.content }];
      for (const part of parts) if (part.type === 'text') found = fromJSON(part.text) || found;
    }
  }
  return found;
}

for (const file of candidates) {
  const hit = search(file);
  if (!hit) continue;
  const buf = Buffer.from(hit.content, 'base64');
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, buf);
  console.log(`✔ ${hit.title} (${hit.mimeType}) → ${out} (${buf.length} bytes)`);
  process.exit(0);
}
console.error(`✖ no download_file_content result for ${fileId} found — call the Drive tool first`);
process.exit(1);
