---
name: lesa
description: Read the GREEN worksheets (Word .docx in the synced Drive folder, or Google Docs via the Drive MCP connector) and turn them into web worksheets (content.json + lang/*.json) rendered by js/worksheet.js; optionally translate them or sync translations with a Google Sheet. Use when the user says "lesa", "lestu verkefnablöðin", "read the worksheets", or asks to import/update worksheets.
---

# /lesa — worksheet documents → GREEN web worksheets

The pipeline is deterministic code; your job is to run it, check the result and report.

```
Word .docx in "New Worksheets septemeber 2026/<Land>/"  ─┐
Google Doc (Drive MCP, export text/markdown)            ─┴▶ tools/reader.mjs
   ▶ ws/<slug>/content.json + lang/en.json + img/ + strings.csv (+ index.html)
   ▶ ws/new-format.html — overview of every document read
   ▶ translations: ws/<slug>/lang/<is|pt|hr|tr|nl>.json (AI, or from a translation Sheet)
```

## 1. Word documents (the partners' worksheets) — main route
The Drive folder is synced to disk by Google Drive for desktop, so no connector is needed.
1. `node tools/reader.mjs folder` — reads every .docx under `New Worksheets septemeber 2026/` (one sub-folder per country: Holland, Tyrkland, Ísland, Króatía, Portúgal). Documents that have not changed since the last read are skipped; `--force` re-reads all.
2. Show the summary lines. For every ⚠ warning, tell the user what to change in the Word document (never patch the JSON by hand — it is overwritten on the next read).
3. The overview is `ws/new-format.html` (http://localhost:8765/ws/new-format.html with the `static` server in `.claude/launch.json`).
Slugs are `<country>-<title>`; a document keeps its folder when re-read.

## 2. Google Docs (Drive MCP connector)
1. **List**: `search_files` with `parentId = '<folder id>' and mimeType = 'application/vnd.google-apps.document'`.
2. **Export**: `download_file_content(fileId, exportMimeType: "text/markdown")`. Do NOT use `read_file_content` (it truncates long documents and garbles emoji). Word files in Drive cannot be exported as Markdown — use route 1 for them.
3. **Save to disk** without copying by hand: `node .claude/skills/lesa/fetch-export.mjs <fileId> <scratchpad>/<slug>.md`
4. **Convert**: `node tools/reader.mjs doc <file.md> --id <slug> --doc-id <fileId> --doc-title "<title>"`
Demo Doc + translation Sheet: Drive folder "Demo – lesari og þýðingar" (id `1Jrgnrf7rP7lKV3uf9DMyyzshxEsXAShU`).

## 3. Translations — ask which route if it is not clear
- *AI*: `node tools/reader.mjs check <slug>` lists what is missing. Translate only missing keys into `ws/<slug>/lang/<lang>.json` (flat `{ key: text }`, `_meta: { "source": "ai", "reviewed": false }`). Keep `**bold**`, `$…$` formulas and `____` blanks, use the language's decimal comma and quotes, European Portuguese, the level names from `lang/worksheet-ui.json`, and the terms of the worksheet's key-terms table.
- *Sheet*: `node tools/reader.mjs sheet-csv <slug> --google --out <scratchpad>/t.csv`, then `create_file` (contentMimeType `text/csv`) with that text. Wait a minute before exporting (GOOGLETRANSLATE shows "Loading..." at first). Read back with `download_file_content(…, "text/csv")` → `fetch-export.mjs` → `node tools/reader.mjs from-sheet <file.csv> --id <slug>`. The connector cannot edit an existing Sheet, only create new ones.

## 4. Check and report
Open a worksheet (`http://localhost:8765/ws/<slug>/?lang=is`), look at page count, questions, boxes, formulas. Report in the user's language (Icelandic): what was read, warnings, content problems spotted in the source, translation coverage. Do not commit or push unless asked.

## What the reader understands (Word and Google Docs)
- **Title**: Title style / Heading 1 (Docs) or the first line; "Worksheet 4 – X", "Worksheet: X", "3.2. X" give code + title. A line "Worksheet 1A" is a code.
- **Info table** (before the body): rows *Topic, Learning outcomes, Time needed, Resources* (and *Student name / Date*, which is ignored). "Basic level: …" lines inside a cell are split per level; "60 – 90 – 150 min" gives one time per level.
- **Levels**: a heading (Heading 1 in Word, Heading 2 in Docs) or a large/bold line starting with *Basic / Medium / Advanced* (optionally "level", "— title") or "LEVEL 2: MEDIUM". A document without level headings but with a line "Level: Basic/intermediate" is one section for those levels.
- **Sub-headings** (*Introduction, Theory, Key terms, Reflection…*): any large or all-bold short line.
- **Tasks**: "Student activity 1" (+ a bold title on the next line), "Activity 1.1: title", "Task 2 – title", or Heading 3 inside a level in Docs.
- **Questions** inside a task: numbered items ("1.", "1-", Word numbering) and bullets that ask something (end with ?, start with Calculate/Explain/Describe…, contain ____ or [ ]). Other bullets stay bullets. A row of underscores under a question = its answer lines; "Answer: ____" = one line; "[ A ] …" lines = answer options.
- **Boxes**: 1×1 tables and Word text boxes; the first bold line (or "**Title:** text") is the title. In Google Docs use a heading starting with *Worked example / Tip / Did you know* instead (Docs flattens table cells).
- **Formulas**: Word equations (converted to LaTeX), `$…$` inline, `$$…$$` on its own line.
- **Videos**: a YouTube link, or a picture linked to YouTube → thumbnail on screen, QR code in print.
- **Images**: PNG/JPEG/GIF embedded in the document (EMF/WMF drawings are skipped).
