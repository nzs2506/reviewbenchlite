import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const worker = readFileSync(new URL('../cloudflare/benchreview-worker.js', import.meta.url), 'utf8');
const start = worker.indexOf('async function getKhlAdmiralMatchStats(');
const end = worker.indexOf('\n}', start) + 2;
assert(start >= 0 && end > start);
const source = worker.slice(start, end);
const event = {
  event: { id: '3000291', stage_id: '407', game_state_key: 'finished', score: '2:0',
    team_a: { id: '61', gf: 2, players: [] }, team_b: { id: '42', gf: 0, players: [] } }
};

async function run(alwaysInvalid = false) {
  let requests = 0;
  let writes = 0;
  const context = vm.createContext({
    String, Number, Date, JSON, URL, setTimeout: fn => fn(),
    ADMIRAL_KHL_SEASON_ID: '407', ADMIRAL_KHL_TEAM_ID: '61', KHL_MOBILE_BASE: 'https://khl.example',
    normalizeKhlMatchPlayer: x => x, fetchKhlGameProtocol: async () => null,
    fetch: async () => ({ ok: true, json: async () => {
      requests++;
      if (alwaysInvalid || requests === 1) throw new SyntaxError('Unterminated string in JSON');
      return event;
    } }),
  });
  vm.runInContext(source, context);
  const env = { BENCHREVIEW_KV: {
    get: async () => { throw new SyntaxError('Corrupt cached JSON'); },
    put: async () => { writes++; }
  } };
  if (alwaysInvalid) {
    await assert.rejects(context.getKhlAdmiralMatchStats(env, '3000291'), /неполные данные матча/);
    assert.equal(requests, 3);
    assert.equal(writes, 0, 'Malformed response must not be cached');
  } else {
    const result = await context.getKhlAdmiralMatchStats(env, '3000291');
    assert.equal(result.ok, true);
    assert.equal(requests, 2, 'Second response should be retried and accepted');
    assert.equal(writes, 1);
  }
}
await run();
await run(true);
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const clientStart = html.indexOf('async function fetchKhlMatchStats(');
const clientEnd = html.indexOf('\n}', clientStart) + 2;
assert(clientStart >= 0 && clientEnd > clientStart);
let clientRequests = 0;
const client = vm.createContext({
  Date, String, Error,
  benchAuthToken: 'test',
  window: { setTimeout: fn => fn() },
  cloudStateUrl: path => path,
  authFetch: async url => {
    clientRequests++;
    if (clientRequests === 1) return { ok: false, status: 502, json: async () => ({ error: 'Unterminated string in JSON' }) };
    assert.match(url, /fresh=1/);
    return { ok: true, status: 200, json: async () => ({ ok: true, players: [] }) };
  }
});
vm.runInContext(html.slice(clientStart, clientEnd), client);
assert.equal((await client.fetchKhlMatchStats({ gameId: '3000291' })).ok, true);
assert.equal(clientRequests, 2);
console.log('KHL incomplete JSON: retry, bad cache bypass and no invalid write passed.');
