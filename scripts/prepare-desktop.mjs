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
  /* Desktop-only visual density for the match sheet. PDF rendering is separate. */
  body.desktop-app[data-view="stats"][data-stats-page="sheet"] .match-sheet-player b {
    width: calc(38px * var(--stats-ui-scale, .92));
    height: calc(31px * var(--stats-ui-scale, .92));
    font-size: calc(15px * var(--stats-ui-scale, .92));
  }
  body.desktop-app[data-view="stats"][data-stats-page="sheet"] .match-sheet-player {
    grid-template-columns: calc(22px * var(--stats-ui-scale, .92)) calc(40px * var(--stats-ui-scale, .92)) minmax(0, 1fr);
    gap: calc(10px * var(--stats-ui-scale, .92));
  }
  body.desktop-app[data-view="stats"][data-stats-page="sheet"] .match-sheet-player span,
  body.desktop-app[data-view="stats"][data-stats-page="sheet"] .match-sheet-value,
  body.desktop-app[data-view="stats"][data-stats-page="sheet"] .match-sheet-rating {
    font-size: calc(14px * var(--stats-ui-scale, .92));
  }
  body.desktop-app[data-view="stats"][data-stats-page="sheet"] .match-sheet-faceoff {
    font-size: calc(13px * var(--stats-ui-scale, .92));
  }
  body.desktop-app[data-view="stats"][data-stats-page="sheet"] .match-sheet-goalie-table td,
  body.desktop-app[data-view="stats"][data-stats-page="sheet"] .match-sheet-goalie-table input {
    font-size: calc(14px * var(--stats-ui-scale, .92));
  }
</style>
</head>`);
desktopHtml = desktopHtml.replace('</body>', `
<script id="desktop-match-sheet-shortcuts">
  (() => {
    const storageKey = 'benchreview-lite.desktop-match-sheet-scale.v1';
    const isMatchSheet = () => !document.getElementById('statsSheetPanel')?.hidden;
    const currentScale = () => Number(getComputedStyle(document.documentElement).getPropertyValue('--stats-ui-scale')) || .92;
    const setScale = value => {
      const scale = Math.min(1.16, Math.max(.62, Math.round(value * 100) / 100));
      document.documentElement.style.setProperty('--stats-ui-scale', String(scale));
      try { localStorage.setItem(storageKey, String(scale)); } catch (_) {}
    };
    const changeScale = delta => setScale(currentScale() + delta);
    // The shared page initializes its own default before this desktop-only
    // block runs. Restore the desktop preference afterwards.
    try { setScale(Number(localStorage.getItem(storageKey)) || currentScale()); } catch (_) {}

    document.addEventListener('click', event => {
      const button = event.target.closest('#btnStatsZoomOut, #btnStatsZoomIn');
      if (!button || !isMatchSheet()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      changeScale(button.id === 'btnStatsZoomIn' ? .06 : -.06);
    }, { capture: true });

    window.addEventListener('keydown', event => {
      if (!event.metaKey || event.ctrlKey || event.altKey || !isMatchSheet()) return;
      const grow = event.key === '+' || event.key === '=' || event.code === 'NumpadAdd';
      const shrink = event.key === '-' || event.code === 'NumpadSubtract';
      if (!grow && !shrink) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      changeScale(grow ? .06 : -.06);
    }, { capture: true });
  })();
</script>
</body>`);
await writeFile(desktopIndex, desktopHtml);

console.log(`Desktop UI prepared: ${desktopDist}`);
