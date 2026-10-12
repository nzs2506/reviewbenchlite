import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('async function fetchKhlMatchStats(');
const end = html.indexOf('function findRosterPlayerForKhl(', start);
assert(start >= 0 && end > start);
const source = html.slice(start, end);

const eventPayload = {
  event: {
    id: '3000999', stage_id: '407', game_state_key: 'finished', score: '2:3', start_at: 1790000000000,
    team_a: { id: '42', gf: 2, shots: 30, players: [] },
    team_b: { id: '61', gf: 3, players: [
      { id: '25', name: 'Олсон Кайл', shirt_number: '25', role_key: 'forward', match_stats: [
        { id: 'toi', val: 15.5 }, { id: 'goals', val: 1 }, { id: 'shots', val: 4 },
        { id: 'fo', val: 6 }, { id: 'fow', val: 5 }, { id: 'si', val: 18 }
      ] },
      { id: '35', name: 'Кульбаков Иван', shirt_number: '35', role_key: 'goaltender', match_stats: [
        { id: 'toi', val: 60 }
      ] }
    ] },
    goals: [{ author: { team_id: '61', shirt_number: '25', name: 'Олсон Кайл' }, assistants: [] }],
    violations: []
  }
};

function makeContext({ cloudResponse, directPayload = eventPayload }) {
  let cloudCalls = 0;
  let directCalls = 0;
  const context = vm.createContext({
    URL, Date, Number, String, Set, Error, Array, Object, JSON,
    window: { setTimeout: fn => fn() }, setTimeout: fn => fn(),
    ADMIRAL_KHL_TEAM_ID: '61', ADMIRAL_KHL_SEASON_ID: '407',
    KHL_MOBILE_BASE: 'https://khl.example', benchAuthToken: 'token',
    cloudStateUrl: path => `https://cloud.example${path}`,
    cloudGetJson: async () => {
      cloudCalls++;
      if (cloudResponse instanceof Error) throw cloudResponse;
      return { response: { ok: true, status: 200 }, data: cloudResponse };
    },
    fetch: async () => {
      directCalls++;
      return { ok: true, status: 200, json: async () => directPayload };
    },
    cleanStatName: value => String(value || '').trim()
  });
  vm.runInContext(source, context);
  return { context, calls: () => ({ cloudCalls, directCalls }) };
}

{
  const { context, calls } = makeContext({ cloudResponse: new TypeError('network unavailable') });
  const result = await context.fetchKhlMatchStats({ gameId: '3000999' }, true);
  assert.equal(result.source, 'khl-direct');
  assert.equal(result.final, true);
  const skater = result.players.find(player => player.number === '25');
  assert.deepEqual(JSON.parse(JSON.stringify({ goals: skater.goals, shots: skater.shots, faceoffs: skater.faceoffs, wins: skater.faceoffWins })),
    { goals: 1, shots: 4, faceoffs: 6, wins: 5 });
  assert.deepEqual(calls(), { cloudCalls: 1, directCalls: 1 });
}

{
  const staleButComplete = {
    ok: true, gameId: '3000999', state: 'finished', final: true,
    updatedAt: '2020-01-01T00:00:00.000Z', players: [{ number: '25', games: 1, shots: 4 }]
  };
  const { context, calls } = makeContext({ cloudResponse: staleButComplete });
  const result = await context.fetchKhlMatchStats({ gameId: '3000999' }, true);
  assert.equal(result, staleButComplete, 'A complete response must not be rejected only because its cache timestamp is old');
  assert.deepEqual(calls(), { cloudCalls: 1, directCalls: 0 });
}

{
  const empty = structuredClone(eventPayload);
  empty.event.team_b.players = [{ id: '25', name: 'Олсон Кайл', shirt_number: '25', role_key: 'forward', match_stats: [] }];
  empty.event.goals = [];
  const { context } = makeContext({ cloudResponse: { ok: true, final: true, state: 'finished', players: [] }, directPayload: empty });
  await assert.rejects(context.fetchKhlMatchStats({ gameId: '3000999' }, true), /Текущие цифры не изменены/);
}

{
  const protectionStart = html.indexOf('const KHL_SAVED_MATCH_PROTECTION_THROUGH = ');
  const protectionEnd = html.indexOf('async function refreshCurrentMatchFromKhl(', protectionStart);
  assert(protectionStart >= 0 && protectionEnd > protectionStart);
  const context = vm.createContext({
    matchSheetArchive: [{ date: '2026-10-10', opponent: 'Лада' }],
    matchSheetOpponentKey: value => String(value || '').toLowerCase()
  });
  vm.runInContext(html.slice(protectionStart, protectionEnd), context);
  assert.equal(context.khlRefreshProtectedSavedMatch({ date: '2026-10-10', opponent: 'Лада' }), true);
  assert.equal(context.khlRefreshProtectedSavedMatch({ date: '2026-10-13', opponent: 'Лада' }), false);
  assert.equal(context.khlRefreshProtectedSavedMatch({ date: '2026-10-10', opponent: 'Другой' }), false);
}

console.log('KHL web fallback: direct import, complete cache, empty-response guard and saved Lada protection passed.');
