import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function source(name, async = false) {
  const start = html.indexOf(`${async ? 'async ' : ''}function ${name}(`);
  const end = html.indexOf('\n}', start) + 2;
  assert(start >= 0 && end > start, name);
  return html.slice(start, end);
}
const a = { id: 'a', date: '2026-09-07', opponent: 'Ак Барс', updatedAt: '2026-09-07T10:00:00Z' };
const aCloud = { ...a, updatedAt: '2026-09-08T10:00:00Z', manual: 4 };
const b = { id: 'b', date: '2026-09-09', opponent: 'Динамо', updatedAt: '2026-09-09T10:00:00Z' };
const c = { id: 'c', date: '2026-09-11', opponent: 'ЦСКА', updatedAt: '2026-09-11T10:00:00Z' };

async function scenario(direction, scope, selected, local, remote) {
  const calls = [];
  let saved = null;
  const status = { textContent: '' };
  const store = { value: JSON.stringify(local), getItem() { return this.value; } };
  const context = vm.createContext({
    Set, Map, Date, JSON, String,
    matchSheetArchive: local.slice(), selectedMatchArchiveIds: new Set(selected),
    document: { getElementById: () => status }, localStorage: store,
    MATCH_ARCHIVE_STORAGE_KEY: 'archive',
    matchArchiveRestoreKey: record => `${record.date}|${record.opponent}`,
    fetchRemoteMatchArchiveStrict: async () => remote,
    benchDbSet: async (_key, value) => { calls.push('snapshot'); saved = value; },
    showConfirm: async () => { calls.push('confirm'); return true; },
    persistMatchSheetArchive: ({ pushRemote }) => {
      assert.equal(pushRemote, false);
      store.value = JSON.stringify(context.matchSheetArchive);
      calls.push('local-save');
    },
    renderMatchArchive() {}, renderMatchesPage() {}, renderStatsPage() {},
    cloudStateUrl: () => '/archive',
    authFetch: async (_url, options) => { calls.push('cloud-put'); assert.equal(options.method, 'PUT'); return { ok: true }; }
  });
  for (const name of ['matchArchiveRecordKey', 'replaceMatchArchiveRecords']) vm.runInContext(source(name), context);
  vm.runInContext(source('transferMatchArchive', true), context);
  await context.transferMatchArchive(direction, scope, { innerHTML: 'Transfer', disabled: false });
  return { calls, local: context.matchSheetArchive, saved, status: status.textContent };
}

let result = await scenario('download', 'selected', ['a'], [a, b], [aCloud, c]);
assert.deepEqual(result.calls, ['confirm', 'snapshot', 'local-save']);
assert.equal(result.local.find(row => row.id === 'a').manual, 4);
assert(result.local.some(row => row.id === 'b'));
assert(!result.local.some(row => row.id === 'c'));
assert.equal(result.saved.local.length, 2);
assert.equal(result.saved.remote.length, 2);

result = await scenario('download', 'all', [], [], [aCloud, c]);
assert.deepEqual(result.calls, ['confirm', 'snapshot', 'local-save']);
assert.equal(result.local.length, 2, 'Fresh app downloads every cloud match');

result = await scenario('upload', 'selected', ['b'], [a, b], [aCloud, c]);
assert.deepEqual(result.calls, ['confirm', 'snapshot', 'cloud-put']);
assert.equal(result.local.length, 2, 'Upload does not mutate local records');

result = await scenario('upload', 'all', [], [a, b], [aCloud, c]);
assert.deepEqual(result.calls, ['confirm', 'snapshot', 'cloud-put']);
console.log('Match archive transfer: selected/all download and upload passed.');
