const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,x-benchreview-token'
};

const MAX_RECORDS_PER_WRITE = 500;
const MAX_STATE_BYTES = 2400000;
const STATE_KEYS = [
  'blocks',
  'planned',
  'goalieMatches',
  'roster',
  'rosterRemoved',
  'matchSheet',
  'matchArchive'
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function cleanTeam(value) {
  return String(value || 'default')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'default';
}

function indexKey(team) {
  return `team:${team}:trainings:index`;
}

function recordKey(team, id) {
  return `team:${team}:trainings:${id}`;
}

function stateKey(team, key) {
  return `team:${team}:state:${key}`;
}

function cleanStateKey(value) {
  const key = String(value || '').trim();
  return STATE_KEYS.includes(key) ? key : '';
}

function publicRecordMeta(record) {
  return {
    id: String(record.id || ''),
    title: String(record.title || ''),
    tag: String(record.tag || ''),
    createdAt: String(record.createdAt || ''),
    updatedAt: String(record.updatedAt || record.createdAt || ''),
    objectCount: Number(record.objectCount || 0),
    screenW: Number(record.screenW || 0),
    screenH: Number(record.screenH || 0)
  };
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const id = String(record.id || '').trim();
  if (!id) return null;
  return {
    ...record,
    id,
    title: String(record.title || 'Training').slice(0, 80),
    createdAt: String(record.createdAt || new Date().toISOString()),
    updatedAt: new Date().toISOString()
  };
}

async function readIndex(env, team) {
  const stored = await env.BENCHREVIEW_KV.get(indexKey(team), 'json');
  return Array.isArray(stored) ? stored.filter(item => item && item.id) : [];
}

async function writeIndex(env, team, index) {
  const byId = new Map();
  index.forEach(item => {
    if (!item || !item.id) return;
    const previous = byId.get(item.id);
    const prevTime = Date.parse(previous?.updatedAt || previous?.createdAt || 0);
    const nextTime = Date.parse(item.updatedAt || item.createdAt || 0);
    if (!previous || nextTime >= prevTime) byId.set(item.id, item);
  });
  const clean = Array.from(byId.values())
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  await env.BENCHREVIEW_KV.put(indexKey(team), JSON.stringify(clean));
  return clean;
}

async function auth(request, env) {
  if (!env.BENCHREVIEW_SYNC_TOKEN) return true;
  return request.headers.get('x-benchreview-token') === env.BENCHREVIEW_SYNC_TOKEN;
}

async function listTrainings(env, team) {
  const index = await readIndex(env, team);
  const records = [];
  for (const item of index) {
    const record = await env.BENCHREVIEW_KV.get(recordKey(team, item.id), 'json');
    if (record) records.push(record);
  }
  return records.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
}

async function putTrainings(request, env, team) {
  const body = await request.json().catch(() => ({}));
  const incoming = Array.isArray(body.records) ? body.records.slice(0, MAX_RECORDS_PER_WRITE) : [];
  const records = incoming.map(normalizeRecord).filter(Boolean);
  const existingIndex = await readIndex(env, team);
  const nextIndex = existingIndex.slice();
  for (const record of records) {
    await env.BENCHREVIEW_KV.put(recordKey(team, record.id), JSON.stringify(record));
    nextIndex.push(publicRecordMeta(record));
  }
  const index = await writeIndex(env, team, nextIndex);
  return json({ ok: true, count: index.length });
}

async function deleteTraining(request, env, team) {
  const url = new URL(request.url);
  const id = String(url.searchParams.get('id') || '').trim();
  if (!id) return json({ ok: false, error: 'id required' }, 400);
  await env.BENCHREVIEW_KV.delete(recordKey(team, id));
  const index = (await readIndex(env, team)).filter(item => item.id !== id);
  await writeIndex(env, team, index);
  return json({ ok: true, count: index.length });
}

async function getState(request, env, team) {
  const url = new URL(request.url);
  const key = cleanStateKey(url.searchParams.get('key'));
  if (key) {
    const state = await env.BENCHREVIEW_KV.get(stateKey(team, key), 'json');
    return json({ ok: true, key, state: state || null });
  }
  const states = {};
  for (const item of STATE_KEYS) {
    states[item] = await env.BENCHREVIEW_KV.get(stateKey(team, item), 'json') || null;
  }
  return json({ ok: true, states });
}

async function putState(request, env, team) {
  const url = new URL(request.url);
  const key = cleanStateKey(url.searchParams.get('key'));
  if (!key) return json({ ok: false, error: 'valid key required' }, 400);
  const bodyText = await request.text();
  if (bodyText.length > MAX_STATE_BYTES) return json({ ok: false, error: 'payload too large' }, 413);
  let body = {};
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch (_) {
    return json({ ok: false, error: 'invalid json' }, 400);
  }
  const state = {
    key,
    value: body.value === undefined ? null : body.value,
    updatedAt: new Date().toISOString()
  };
  await env.BENCHREVIEW_KV.put(stateKey(team, key), JSON.stringify(state));
  return json({ ok: true, key, updatedAt: state.updatedAt });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: JSON_HEADERS });
    if (!env.BENCHREVIEW_KV) return json({ ok: false, error: 'BENCHREVIEW_KV binding is missing' }, 500);
    if (!(await auth(request, env))) return json({ ok: false, error: 'unauthorized' }, 401);

    const url = new URL(request.url);
    const team = cleanTeam(url.searchParams.get('team'));

    if (url.pathname === '/api/health') return json({ ok: true, service: 'benchreview-lite-api' });
    if (url.pathname === '/api/trainings' && request.method === 'GET') {
      return json({ ok: true, records: await listTrainings(env, team) });
    }
    if (url.pathname === '/api/trainings' && (request.method === 'PUT' || request.method === 'POST')) {
      return putTrainings(request, env, team);
    }
    if (url.pathname === '/api/trainings' && request.method === 'DELETE') {
      return deleteTraining(request, env, team);
    }
    if (url.pathname === '/api/state' && request.method === 'GET') {
      return getState(request, env, team);
    }
    if (url.pathname === '/api/state' && (request.method === 'PUT' || request.method === 'POST')) {
      return putState(request, env, team);
    }
    return json({ ok: false, error: 'not found' }, 404);
  }
};
