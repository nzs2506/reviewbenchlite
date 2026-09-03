const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-benchreview-token'
};

const MAX_RECORDS_PER_WRITE = 500;
const MAX_STATE_BYTES = 2400000;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_LOGIN_USER = 'Shaidullin.a';
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

function base64Url(bytes) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function utf8(value) {
  return new TextEncoder().encode(String(value));
}

async function hmacSign(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    utf8(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return base64Url(await crypto.subtle.sign('HMAC', key, utf8(message)));
}

async function sha256(value) {
  return base64Url(await crypto.subtle.digest('SHA-256', utf8(value)));
}

function safeEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function authSecret(env) {
  return String(env.BENCHREVIEW_AUTH_SECRET || env.BENCHREVIEW_LOGIN_PASSWORD || 'benchreview-dev-secret').trim();
}

async function createSessionToken(env, username) {
  const cleanUser = String(username || DEFAULT_LOGIN_USER).trim();
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = base64Url(utf8(JSON.stringify({ user: cleanUser, exp: expires })));
  const signature = await hmacSign(authSecret(env), payload);
  return `${payload}.${signature}`;
}

async function verifySessionToken(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = await hmacSign(authSecret(env), payload);
  if (!safeEqual(signature, expected)) return null;
  let session;
  try {
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    session = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), char => char.charCodeAt(0))));
  } catch (_) {
    return null;
  }
  if (!session?.user || Number(session.exp || 0) < Math.floor(Date.now() / 1000)) return null;
  return session;
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

async function login(request, env) {
  if (!env.BENCHREVIEW_LOGIN_PASSWORD && !env.BENCHREVIEW_LOGIN_PASSWORD_HASH) {
    return json({ ok: false, error: 'login is not configured' }, 503);
  }
  const body = await request.json().catch(() => ({}));
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const expectedUser = String(env.BENCHREVIEW_LOGIN_USER || DEFAULT_LOGIN_USER).trim();
  const expectedHash = String(env.BENCHREVIEW_LOGIN_PASSWORD_HASH || '').trim();
  const expectedPassword = String(env.BENCHREVIEW_LOGIN_PASSWORD || '').trim();
  const passwordOk = expectedHash
    ? safeEqual(await sha256(password), expectedHash)
    : safeEqual(password, expectedPassword);
  if (username.toLowerCase() !== expectedUser.toLowerCase() || !passwordOk) {
    return json({ ok: false, error: 'invalid credentials' }, 401);
  }
  return json({
    ok: true,
    user: expectedUser,
    token: await createSessionToken(env, expectedUser),
    expiresIn: SESSION_TTL_SECONDS
  });
}

async function auth(request, env) {
  if (env.BENCHREVIEW_SYNC_TOKEN && request.headers.get('x-benchreview-token') === env.BENCHREVIEW_SYNC_TOKEN) {
    return { user: 'sync-token' };
  }
  if (!env.BENCHREVIEW_LOGIN_PASSWORD && !env.BENCHREVIEW_LOGIN_PASSWORD_HASH) return { user: 'open' };
  return await verifySessionToken(request, env);
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

async function getTraining(env, team, id) {
  const cleanId = String(id || '').trim();
  if (!cleanId) return null;
  return await env.BENCHREVIEW_KV.get(recordKey(team, cleanId), 'json');
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
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return json({ ok: true, service: 'benchreview-lite-api' });
    if (url.pathname === '/api/login' && request.method === 'POST') return login(request, env);
    if (!env.BENCHREVIEW_KV) return json({ ok: false, error: 'BENCHREVIEW_KV binding is missing' }, 500);
    const session = await auth(request, env);
    if (!session) return json({ ok: false, error: 'unauthorized' }, 401);

    const team = cleanTeam(url.searchParams.get('team'));

    if (url.pathname === '/api/session') return json({ ok: true, user: session.user });
    if (url.pathname === '/api/trainings' && request.method === 'GET') {
      const id = String(url.searchParams.get('id') || '').trim();
      if (id) {
        const record = await getTraining(env, team, id);
        return record ? json({ ok: true, record }) : json({ ok: false, error: 'not found' }, 404);
      }
      if (url.searchParams.get('summary') === '1') {
        return json({ ok: true, records: await readIndex(env, team), summary: true });
      }
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
