import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const desktopDist = resolve(projectRoot, 'desktop', 'dist');

await rm(desktopDist, { recursive: true, force: true });
await mkdir(desktopDist, { recursive: true });
const sourceIndex = resolve(projectRoot, 'index.html');
const desktopIndex = resolve(desktopDist, 'index.html');
await cp(sourceIndex, desktopIndex);
await cp(resolve(projectRoot, 'assets'), resolve(desktopDist, 'assets'), { recursive: true });

// The desktop shell deliberately gets a few interaction refinements without
// changing the browser version of BenchReview Lite.
let desktopHtml = await readFile(desktopIndex, 'utf8');
desktopHtml = desktopHtml.replace('<body>', '<body class="desktop-app">');
desktopHtml = desktopHtml.replace('</head>', `
<style id="desktop-match-sheet-zoom">
  /* Desktop-only Excel-like zoom: the whole table scales as one object.
     PDF generation is separate and is never affected by this value. */
  body.desktop-app[data-view="stats"][data-stats-page="sheet"] {
    --desktop-sheet-zoom: 1;
  }
  body.desktop-app[data-view="stats"][data-stats-page="sheet"] .match-sheet-table,
  body.desktop-app[data-view="stats"][data-stats-page="sheet"] .match-sheet-goalie-table {
    zoom: var(--desktop-sheet-zoom, 1);
  }
  body.desktop-app .desktop-sheet-zoom-value {
    min-width: 42px;
    color: #aab3c1;
    font-size: 12px;
    font-weight: 800;
    text-align: center;
  }
</style>
</head>`);
desktopHtml = desktopHtml.replace('</body>', `
<script id="desktop-match-sheet-shortcuts">
  (() => {
    const storageKey = 'benchreview-lite.desktop-match-sheet-scale.v1';
    const isMatchSheet = () => !document.getElementById('statsSheetPanel')?.hidden;
    const currentScale = () => Number(getComputedStyle(document.body).getPropertyValue('--desktop-sheet-zoom')) || 1;
    const zoomLabel = () => document.getElementById('desktopSheetZoomValue');
    const updateLabel = scale => {
      const label = zoomLabel();
      if (label) label.textContent = Math.round(scale * 100) + '%';
    };
    const setScale = value => {
      const scale = Math.min(1.25, Math.max(.55, Math.round(value * 100) / 100));
      document.body.style.setProperty('--desktop-sheet-zoom', String(scale));
      updateLabel(scale);
      try { localStorage.setItem(storageKey, String(scale)); } catch (_) {}
    };
    const changeScale = delta => setScale(currentScale() + delta);
    const controls = document.querySelector('[aria-label="Масштаб статистики"]');
    if (controls && !zoomLabel()) {
      const label = document.createElement('span');
      label.id = 'desktopSheetZoomValue';
      label.className = 'desktop-sheet-zoom-value';
      controls.insertBefore(label, controls.children[1] || null);
    }
    // The shared page initializes its own default before this desktop-only
    // block runs. Restore the desktop preference afterwards.
    try { setScale(Number(localStorage.getItem(storageKey)) || 1); } catch (_) { setScale(1); }

    document.addEventListener('click', event => {
      const button = event.target.closest('#btnStatsZoomOut, #btnStatsZoomIn');
      if (!button || !isMatchSheet()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      changeScale(button.id === 'btnStatsZoomIn' ? .10 : -.10);
    }, { capture: true });

    window.addEventListener('keydown', event => {
      if (!event.metaKey || event.ctrlKey || event.altKey || !isMatchSheet()) return;
      const grow = event.key === '+' || event.key === '=' || event.code === 'NumpadAdd';
      const shrink = event.key === '-' || event.code === 'NumpadSubtract';
      if (!grow && !shrink) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      changeScale(grow ? .10 : -.10);
    }, { capture: true });
  })();
</script>
</body>`);
await writeFile(desktopIndex, desktopHtml);

console.log(`Desktop UI prepared: ${desktopDist}`);
