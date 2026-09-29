import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf("let matchSheetMonthFilter = '';");
const end = html.indexOf('\nfunction admiralMatchDateLabel', start);
function element() {
  return { children: [], value: '', set innerHTML(value) { this.children = []; }, appendChild(child) { this.children.push(child); } };
}
const elements = { matchSheetMonthSelect: element(), matchSheetMatchSelect: element() };
const sheet = { date: '2026-09-19', opponent: 'Северсталь', archiveId: '' };
const context = vm.createContext({
  document: { getElementById: id => elements[id], createElement: element },
  matchSheetState: sheet,
  todayInputValue: () => '2026-09-29',
  admiralMatches: [{ id: 'sep', date: '2026-09-19' }, { id: 'aug', date: '2026-08-20' }, { id: 'oct', date: '2026-10-02' }],
  matchSheetArchive: [{ id: 'old', date: '2026-07-15', opponent: 'Старый матч' }],
  admiralMatchSort: (a, b) => a.date.localeCompare(b.date),
  matchSheetIsRelatedToMatch: match => match.date === sheet.date,
  matchArchiveBelongsToKhlMatch: (record, match) => record.date === match.date,
  admiralMatchTitle: match => match.id,
});
vm.runInContext(html.slice(start, end), context);
context.renderMatchSheetMatchSelect();
assert.equal(elements.matchSheetMonthSelect.value, '2026-09');
assert.equal(elements.matchSheetMatchSelect.value, 'sep');
vm.runInContext("matchSheetMonthFilter = '2026-08'; renderMatchSheetMatchSelect();", context);
assert.deepEqual(elements.matchSheetMatchSelect.children.map(x => x.value), ['manual', 'aug']);
assert.equal(sheet.date, '2026-09-19', 'Filtering must not edit the open match');
context.renderMatchSheetMatchSelect();
assert.equal(elements.matchSheetMonthSelect.value, '2026-08', 'Rerender keeps the filter');
vm.runInContext("matchSheetMonthFilter = '2026-07'; renderMatchSheetMatchSelect();", context);
assert.deepEqual(elements.matchSheetMatchSelect.children.map(x => x.value), ['manual', 'archive:old']);
sheet.date = '2026-10-02'; context.renderMatchSheetMatchSelect();
assert.equal(elements.matchSheetMonthSelect.value, '2026-10');
assert.equal(elements.matchSheetMatchSelect.value, 'oct');
console.log('Month selector: current, previous, archived-only month and navigation passed.');
