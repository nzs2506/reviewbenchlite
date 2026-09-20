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
  /* Desktop-only status label. The actual zoom is native Tauri/WebKit zoom. */
  body.desktop-app .desktop-sheet-zoom-value {
    min-width: 42px;
    color: #aab3c1;
    font-size: 12px;
    font-weight: 800;
    text-align: center;
  }

  /* Keep the delete action visually centred in its own lane, rather than
     pressed against the frozen player column's edge. */
  body.desktop-app .match-sheet-player-cell-inner {
    grid-template-columns: 18px minmax(0, 1fr) 64px;
  }
  body.desktop-app .match-sheet-row-remove {
    justify-self: center;
  }

  /* Every statistics section uses the same header grid. The tab strip stays
     anchored to the top-right corner even when a page has a different title,
     action row, or a vertical scrollbar. */
  @media (min-width: 900px) {
    body.desktop-app .stats-view,
    body.desktop-app .matches-view {
      scrollbar-gutter: stable;
    }
    body.desktop-app .stats-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) max-content;
      align-items: start;
      min-height: 42px;
    }
    body.desktop-app .stats-head .stats-tabs {
      justify-self: end;
      align-self: start;
    }
    body.desktop-app .matches-head {
      grid-template-columns: minmax(0, 1fr) auto max-content;
      align-items: start;
      min-height: 42px;
    }
    body.desktop-app .matches-tabs {
      justify-self: end;
      align-self: start;
    }
  }
</style>
</head>`);
desktopHtml = desktopHtml.replace('</body>', `
<script id="desktop-match-sheet-shortcuts">
  (() => {
    const storageKey = 'benchreview-lite.desktop-native-page-zoom.v1';
    const isMatchSheet = () => !document.getElementById('statsSheetPanel')?.hidden;
    let appliedScale = 1;
    let sheetScale = 1;
    let zoomRequest = 0;
    const zoomLabel = () => document.getElementById('desktopSheetZoomValue');
    const updateLabel = scale => {
      const label = zoomLabel();
      if (label) label.textContent = Math.round(scale * 100) + '%';
    };
    const setScale = async (value, { persist = false } = {}) => {
      const nextScale = Math.min(1.25, Math.max(.55, Math.round(value * 100) / 100));
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (typeof invoke !== 'function') return;
      const request = ++zoomRequest;
      try {
        await invoke('set_page_zoom', { zoom: nextScale });
        if (request !== zoomRequest) return;
        appliedScale = nextScale;
        if (persist) {
          sheetScale = nextScale;
          try { localStorage.setItem(storageKey, String(sheetScale)); } catch (_) {}
        }
        updateLabel(sheetScale);
      } catch (error) {
        console.warn('Native desktop zoom was not applied:', error);
      }
    };
    const changeScale = delta => void setScale(sheetScale + delta, { persist: true });
    const syncZoomForCurrentPage = () => void setScale(isMatchSheet() ? sheetScale : 1);
    const controls = document.querySelector('[aria-label="Масштаб статистики"]');
    if (controls && !zoomLabel()) {
      const label = document.createElement('span');
      label.id = 'desktopSheetZoomValue';
      label.className = 'desktop-sheet-zoom-value';
      controls.insertBefore(label, controls.children[1] || null);
    }
    // The saved value belongs only to the desktop shell. The browser version
    // neither reads nor changes it.
    try { sheetScale = Number(localStorage.getItem(storageKey)) || 1; } catch (_) { sheetScale = 1; }
    updateLabel(sheetScale);
    syncZoomForCurrentPage();

    // Native WebKit zoom affects the entire webview. Keep it strictly scoped
    // to the match sheet: other desktop pages, especially the rink canvas,
    // always return to their normal 100% layout.
    const sheetPanel = document.getElementById('statsSheetPanel');
    const zoomObserver = new MutationObserver(syncZoomForCurrentPage);
    zoomObserver.observe(document.body, { attributes: true, attributeFilter: ['data-view', 'data-stats-page'] });
    if (sheetPanel) zoomObserver.observe(sheetPanel, { attributes: true, attributeFilter: ['hidden'] });

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
