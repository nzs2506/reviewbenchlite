import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function functionSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert(start >= 0, `Missing function ${name}`);
  const open = html.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    else if (html[index] === '}' && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}

const blankPlayer = () => ({
  games: 0, plus: 0, minus: 0, powerPlay: '', shortHanded: '', assists: '', mmPoints: '',
  penalties: [0, 0, 0], opponentPenalties: [0, 0, 0], opponentPenaltyTotal: '',
  goals: [0, 0, 0], shots: [0, 0, 0], faceoffWins: [0, 0, 0], faceoffLosses: [0, 0, 0],
  faceoffsTotal: '', highlights: {}, goalieStats: {}
});
const goalieFields = ['games', 'wins', 'losses', 'ot', 'shotsAgainst', 'goalsAgainst', 'saves', 'savePercent', 'gaa', 'shutouts', 'assists', 'pim', 'ice', 'zoneP'];
const context = vm.createContext({
  rosterPlayers: [], goalieSavedMatches: [],
  MATCH_GOALIE_COLUMNS: goalieFields.map(key => [key, key, key]),
  cleanStatName: value => String(value || '').trim(),
  khlStatsNameKey: value => String(value || '').trim().toLowerCase(),
  safeStatNumber: value => Number.isFinite(Number(String(value || '').replace(',', '.'))) ? Number(String(value || '').replace(',', '.')) : 0,
  normalizeMatchSheetPlayer: value => ({ ...blankPlayer(), ...(value || {}) }),
  normalizeMatchGoalieStats: value => Object.fromEntries(goalieFields.map(key => [key, String(value?.[key] ?? '')])),
  parseGoalieIceMinutes: value => {
    const match = String(value || '').match(/^(\d+):(\d+)$/);
    return match ? Number(match[1]) + Number(match[2]) / 60 : 0;
  },
  formatGoalieIce: value => `${Math.floor(value)}:${String(Math.round((value % 1) * 60)).padStart(2, '0')}`,
  matchSheetTotalValue: (state, field) => ({
    penaltyTotal: state.penalties.reduce((a, b) => a + Number(b || 0), 0),
    opponentPenaltyTotal: state.opponentPenalties.reduce((a, b) => a + Number(b || 0), 0) || state.opponentPenaltyTotal,
    goalsTotal: state.goals.reduce((a, b) => a + Number(b || 0), 0),
    shotsTotal: state.shots.reduce((a, b) => a + Number(b || 0), 0)
  })[field],
  matchSheetFaceoffPair: state => ({
    wins: state.faceoffWins.reduce((a, b) => a + Number(b || 0), 0),
    losses: state.faceoffLosses.reduce((a, b) => a + Number(b || 0), 0)
  }),
  matchSheetPositionSort: (a, b) => Number(a.number) - Number(b.number),
  matchSheetOpponentKey: value => String(value || '').toLowerCase(),
});
for (const name of ['matchArchivePlayerKey', 'addMatchSheetManualValue', 'emptyAggregateGoalieStats',
  'addAggregateGoalieStats', 'matchGoalieStatsHaveData', 'aggregateMatchRecords', 'matchAggregateSelectionKey']) {
  vm.runInContext(functionSource(name), context);
}
context.goalieSavedStatsForMatch = () => context.emptyAggregateGoalieStats();

const skater = { id: 'p7', role: 'defense', number: '7', name: 'Игрок 7' };
const goalie = { id: 'g35', role: 'goalie', number: '35', name: 'Вратарь 35' };
context.rosterPlayers.push(skater, goalie);
const record = (id, updatedAt, skaterState, goalieStats) => ({
  id, updatedAt, date: `2026-09-${id === 'a' ? '07' : '09'}`, opponent: id,
  roster: [skater, goalie], sheet: { excludedPlayerIds: [], players: {
    p7: { ...blankPlayer(), ...skaterState },
    g35: { ...blankPlayer(), goalieStats }
  } }
});
const first = record('a', '2026-09-07T20:00:00Z', {
  games: 1, plus: 1, minus: 0, powerPlay: '0-1', shortHanded: '1/0', assists: '1', mmPoints: '2',
  penalties: [2, 0, 0], goals: [1, 0, 0], shots: [3, 0, 0], faceoffWins: [3, 0, 0], faceoffLosses: [2, 0, 0]
}, { games: 1, wins: 1, shotsAgainst: 30, goalsAgainst: 2, saves: 28, ice: '60:00', zoneP: 2 });
const second = record('b', '2026-09-09T20:00:00Z', {
  games: 1, plus: 0, minus: 1, powerPlay: '0–2', shortHanded: '0—1', assists: '2', mmPoints: '3',
  penalties: [4, 0, 0], goals: [0, 0, 0], shots: [5, 0, 0], faceoffWins: [4, 0, 0], faceoffLosses: [1, 0, 0]
}, { games: 1, losses: 1, shotsAgainst: 20, goalsAgainst: 1, saves: 19, ice: '40:00', zoneP: 3 });
const totals = context.aggregateMatchRecords([first, second]);
const playerTotal = totals.find(row => row.player.id === 'p7');
assert.deepEqual(JSON.parse(JSON.stringify({
  games: playerTotal.games, plus: playerTotal.plus, minus: playerTotal.minus,
  powerPlay: playerTotal.powerPlay, shortHanded: playerTotal.shortHanded,
  penaltyTotal: playerTotal.penaltyTotal, goalsTotal: playerTotal.goalsTotal,
  assists: playerTotal.assists, shotsTotal: playerTotal.shotsTotal,
  faceoffs: `${playerTotal.faceoffWins}-${playerTotal.faceoffLosses}`, mmPoints: playerTotal.mmPoints
})), { games: 2, plus: 1, minus: 1, powerPlay: '0-3', shortHanded: '1-1', penaltyTotal: 6,
  goalsTotal: 1, assists: 3, shotsTotal: 8, faceoffs: '7-3', mmPoints: 5 });
const goalieTotal = totals.find(row => row.player.id === 'g35').goalieStats;
assert.equal(goalieTotal.games, '2');
assert.equal(goalieTotal.shotsAgainst, '50');
assert.equal(goalieTotal.goalsAgainst, '3');
assert.equal(goalieTotal.saves, '47');
assert.equal(goalieTotal.savePercent, '94.0');
assert.equal(goalieTotal.gaa, '1.80');
assert.equal(goalieTotal.ice, '100:00');
assert.equal(goalieTotal.zoneP, '5');

const oldKey = context.matchAggregateSelectionKey([first, second]);
const corrected = { ...second, updatedAt: '2026-09-10T10:00:00Z' };
assert.notEqual(context.matchAggregateSelectionKey([first, corrected]), oldKey,
  'Saving a corrected match must invalidate stale summary edits');
assert.equal(context.addMatchSheetManualValue('1–0', '0/2'), '1-2');
console.log('Match aggregate: manual skaters, faceoffs, goalie totals and revision invalidation passed.');
