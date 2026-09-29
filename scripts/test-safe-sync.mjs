import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function source(name) {
  const start = html.indexOf(`async function ${name}(`);
  const end = html.indexOf('\n}', start) + 2;
  assert(start >= 0 && end > start);
  return html.slice(start, end);
}
// Check every inline script as well as the isolated behavioural tests.
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
function sheet({ remote = [], dirty = false, local = [], accept = false } = {}) {
  const calls = [];
  const context = vm.createContext({
    matchSheetState: { opponent: 'Ак Барс', date: '2026-09-07' },
    matchSheetArchive: local,
    fetchRemoteCloudState: async () => remote === null ? null : { matchArchive: { value: remote } },
    matchArchiveRestoreKey: record => (record.sheet || record).opponent,
    matchSheetHasUnsavedChanges: () => dirty,
    mergeMatchArchives: (a, b) => b.length ? b : a,
    persistMatchSheetArchive: () => {}, renderMatchesPage: () => {},
    openArchivedMatchSheet: async id => calls.push(['open', id]),
    showConfirm: async () => { calls.push(['confirm']); return accept; },
    saveMatchSheetToArchive: async () => calls.push(['save']),
    saveMatchSheetBackupCopies: async () => calls.push(['upload']),
  });
  vm.runInContext(source('synchronizeCurrentMatchSheet'), context);
  return { calls, run: () => context.synchronizeCurrentMatchSheet({ disabled: false }) };
}
const record = { id: 'saved', opponent: 'Ак Барс', updatedAt: '2026-09-21T10:00:00Z' };
let test = sheet({ remote: [record] }); await test.run();
assert.deepEqual(test.calls, [['open', 'saved']], 'Clean empty draft must download without saving');
test = sheet({ remote: null, dirty: true, accept: true }); await test.run();
assert(!test.calls.some(([kind]) => kind === 'save' || kind === 'upload'), 'Failed GET must forbid writes');
test = sheet({ remote: [record], dirty: true }); await test.run();
assert.deepEqual(test.calls, [['confirm']], 'Rejected conflict must leave the draft unsaved');
test = sheet({ remote: [record], dirty: true, accept: true }); await test.run();
assert.deepEqual(test.calls, [['confirm'], ['save']]);
test = sheet({ local: [record], accept: true }); await test.run();
assert.deepEqual(test.calls, [['open', 'saved'], ['confirm'], ['upload']], 'Local save uploads without changing its timestamp');

async function general(failed = false) {
  const calls = [];
  const keys = ['blocks', 'planned', 'goalieMatches', 'roster', 'rosterRemoved', 'matchArchive', 'matches'];
  const context = vm.createContext({
    structuredClone, console, Date, CLOUD_STATE_KEYS: keys, trainingRecords: [],
    fetchRemoteCloudState: async () => failed ? null : Object.fromEntries(keys.map(key => [key, { value: [{ id: key }] }])),
    fetchRemoteTrainingRecords: async () => [{ id: 'remote-training' }],
    cloudStateValue: () => [], localStorage: { setItem() {} },
    applyRemoteCloudState() {},
    pushCloudStateKey: async () => { calls.push('upload'); return true; },
    pushRemoteTrainingRecords: async () => { calls.push('training-upload'); return true; },
    dropboxReadConnection: () => true,
    backupBoardToDropbox: async () => { calls.push('dropbox'); return { failed: 0 }; },
    window: { setTimeout(fn) { fn(); } },
  });
  for (const name of ['persistTrainingBlocks', 'persistPlannedTrainings', 'persistGoalieMatches', 'persistRosterPlayers', 'persistRosterRemovedKeys', 'persistAdmiralMatches', 'persistMatchSheetArchive', 'persistTrainingRecords', 'renderTrainingList', 'renderStatsPage', 'renderMatchesPage', 'renderCalendar', 'renderGoaliePage']) context[name] = () => {};
  vm.runInContext(source('synchronizeBenchReview'), context);
  await context.synchronizeBenchReview({ innerHTML: 'Sync' });
  assert.deepEqual(calls, [], 'Empty install / failed GET must never upload or back up blanks');
  if (!failed) assert.equal(context.trainingRecords[0].id, 'remote-training');
}
await general(); await general(true);
console.log('Safe sync: 7 scenarios passed; inline scripts parse successfully.');
