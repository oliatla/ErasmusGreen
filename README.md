# GREEN Worksheets

Smart-home worksheets for vocational schools, produced under the
**GREEN Erasmus+ KA220-VET** programme. Printable HTML worksheets,
available in six languages, with image and YouTube support.

> Project № **2025-1-HR01-KA220-VET-000353056**
> Co-funded by the European Union.

---

## What this is

A collection of self-contained, printable worksheets for upper-secondary
students. Each worksheet:

- **Renders in any web browser** — no build step, no server, just static HTML
- **Prints to A4** with proper page numbering, header, footer and EU disclaimer
- **Switches between six languages** at the click of a flag — IS · EN · PT · HR · TR · NL
- **Embeds YouTube videos** on screen, swaps to a scannable QR code in print
- **Has a B/W toggle** so it prints cleanly on greyscale printers
- **Reads its content from JSON files**, so a teacher (or translator) can
  modify text without touching code

---

## Repository structure

```
green-worksheets/
├── index.html              ← landing page, lists all worksheets
├── README.md               ← this file
├── translator-guide.html   ← interactive guide for translators (IS/EN)
├── img/                    ← global assets used on every worksheet
│   ├── greenlogo.png
│   └── eufounded.png
├── js/                     ← shared JavaScript
│   └── qrcode.js
└── ws/                     ← all worksheets
    ├── ws01/               ← worksheet 1
    │   ├── index.html
    │   ├── img/            ← images used only by this worksheet
    │   └── lang/           ← translations
    │       ├── is.json
    │       ├── en.json
    │       └── ...
    ├── ws02/               ← worksheet 2
    └── ws03/               ← worksheet 3
```

Each `wsNN/` folder is fully self-contained — its images and its
translations live alongside the HTML that uses them. This makes it easy
to add, remove or hand a single worksheet to a colleague.

---

## How to view locally

The whole repo is static. Open `index.html` in any browser and you're
running. No web server required.

For more accurate path resolution while developing (some browsers
restrict `file://` URLs), serve the folder with any static server:

```bash
# Python (any version):
python3 -m http.server 8000

# Node:
npx serve .
```

Then open <http://localhost:8000/>.

---

## How to deploy

Drop the whole repo into any static host:

- **Netlify** — connect the GitHub repo, no build command, publish directory `/`
- **GitHub Pages** — enable Pages on the `main` branch, root
- **Any web host** — upload the folder via FTP

---

## For translators

Open `translator-guide.html` in a browser. It explains how to:

- Edit the JSON files in `ws/wsNN/lang/`
- Add a new language
- Insert images and YouTube videos
- Use formatting symbols correctly

No coding knowledge needed.

---

## For developers — adding a new worksheet

1. Copy `ws/ws01/` to `ws/wsNN/` (next number).
2. In `ws/wsNN/index.html` update:
   - Worksheet title and number
   - YouTube ID (if a different example video is wanted)
3. Replace images in `ws/wsNN/img/` with the ones for the new topic.
4. Edit `ws/wsNN/lang/is.json` (Icelandic source).
5. Hand the JSON file to translators — they produce `en.json`, `pt.json`, etc.
6. Add a card for the new worksheet to the root `index.html`.

That's it. No build, no bundler, no dependencies.

---

## Tech stack

- **HTML / CSS / vanilla JavaScript** — no frameworks
- **KaTeX** (CDN) — for math formulas
- **qrcode-generator** (local `js/qrcode.js`) — for printable QR codes
- **Google Fonts** (Lato + Open Sans) — typography
- **JSON** — for translatable content

Browser support: any browser from the last five years. Tested in
Chrome, Edge, Firefox and Safari.

---

## Licensing

This repository uses **dual licensing**:

| Part of the repo | Licence | File |
|---|---|---|
| **Educational content** — worksheets, translations, text, JSON, worksheet illustrations | **CC BY 4.0** | [`LICENSE-content`](LICENSE-content) |
| **Source code** — HTML structure, CSS, JavaScript, SVG flag/icon library, build scripts | **MIT** | [`LICENSE`](LICENSE) |

Both licences allow free use, modification and redistribution — including
in commercial contexts — provided that proper attribution is given.

### Suggested attribution for the content

> "Energy & Water Worksheets" by The GREEN Partnership
> (Erasmus+ KA220-VET project № 2025-1-HR01-KA220-VET-000353056),
> licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

### Erasmus+ Open Access requirement

This dual-licensing approach satisfies the Erasmus+ programme's Open
Access requirement, which mandates that all project outputs be freely
accessible under open licences. Creative Commons Attribution (CC BY) is
the standard recommendation for Open Educational Resources (OER) funded
by EU programmes.

### EU funding disclaimer

> Funded by the European Union. Views and opinions expressed are however
> those of the author(s) only and do not necessarily reflect those of the
> European Union or the European Education and Culture Executive Agency
> (EACEA). Neither the European Union nor EACEA can be held responsible
> for them.

---

## Partner institutions

Five vocational schools from Iceland, Portugal, Croatia, Türkiye and
the Netherlands collaborate on this project. The shared topic is
**School Environment** — using technology (sensors, automation, smart
controls) to reduce resource consumption in school buildings.
