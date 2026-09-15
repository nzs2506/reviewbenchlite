#!/usr/bin/env node
/*
 * Rebuilds saved KHL match sheets from cached KHL responses without changing
 * the coach-entered columns: БОЛ, МЕН, ШТР +, ПАС, ВБР/ручной ввод, ОММ,
 * event log, notes and cell highlights.
 *
 * Usage:
 * node scripts/restore-khl-match-archive.mjs archive.json restored.json \
 *   2026-09-07=ak-bars.json 2026-09-09=dynamo.json ...
 */
import fs from 'node:fs';

const [archivePath, outputPath, ...sourceArgs] = process.argv.slice(2);
if (!archivePath || !outputPath || !sourceArgs.length) {
  throw new Error('Usage: restore-khl-match-archive.mjs <archive.json> <output.json> YYYY-MM-DD=<khl.json> [...]');
}

const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const number = value => Math.max(0, Math.round(Number(value) || 0));
const normalizedName = value => String(value || '').trim().toLowerCase().replace(/ё/g, 'е');
const pad = value => String(value).padStart(2, '0');
const formatMinutes = value => {
  const minutes = Math.max(0, Number(value) || 0);
  const whole = Math.floor(minutes);
  const seconds = Math.round((minutes - whole) * 60);
  return `${whole + Math.floor(seconds / 60)}:${pad(seconds % 60)}`;
};
const sources = new Map(sourceArgs.map(arg => {
  const separator = arg.indexOf('=');
  if (separator < 1) throw new Error(`Invalid source: ${arg}`);
  return [arg.slice(0, separator), read(arg.slice(separator + 1))];
}));
const archiveState = read(archivePath);
if (!Array.isArray(archiveState?.value)) throw new Error('Expected Cloudflare state wrapper with an array in value');

function rosterPlayerFor(record, entry) {
  const role = String(entry?.role || 'forward');
  const numberText = String(entry?.number || '').trim();
  const name = normalizedName(entry?.name);
  const eligible = (record.roster || []).filter(player => player.role === role);
  return eligible.find(player => String(player.number || '').trim() === numberText)
    || eligible.find(player => normalizedName(player.name) === name)
    || null;
}

function restoreSkater(state, entry) {
  const before = JSON.stringify({
    games: state.games, plus: state.plus, minus: state.minus,
    goals: state.goals, shots: state.shots, penalties: state.penalties,
    faceoffWins: state.faceoffWins, faceoffLosses: state.faceoffLosses
  });
  const hasSavedBase = number(state.games) > 0 || [state.goals, state.shots]
    .some(values => (values || []).some(number)) || number(state.plus) > 0 || number(state.minus) > 0;
  if (!hasSavedBase) {
    if (entry.games !== undefined) state.games = number(entry.games);
    if (entry.plus !== undefined) state.plus = number(entry.plus);
    if (entry.minus !== undefined) state.minus = number(entry.minus);
    if (entry.goals !== undefined) state.goals = [number(entry.goals), 0, 0];
    if (entry.shots !== undefined) state.shots = [number(entry.shots), 0, 0];
    if (entry.pim !== undefined) state.penalties = [number(entry.pim), 0, 0];
    if (entry.faceoffs !== undefined && number(entry.faceoffs) > 0) {
      const wins = Math.min(number(entry.faceoffs), number(entry.faceoffWins));
      state.faceoffWins = [wins, 0, 0];
      state.faceoffLosses = [number(entry.faceoffs) - wins, 0, 0];
      state.faceoffsTotal = '';
    }
  }
  return before !== JSON.stringify({
    games: state.games, plus: state.plus, minus: state.minus,
    goals: state.goals, shots: state.shots, penalties: state.penalties,
    faceoffWins: state.faceoffWins, faceoffLosses: state.faceoffLosses
  });
}

function restoreGoalie(state, entry) {
  const stats = state.goalieStats ||= {};
  const source = entry.protocolGoalie || {};
  const values = {
    games: entry.goalieGames ?? source.games,
    wins: source.wins,
    losses: source.losses,
    shootoutGames: source.shootoutGames,
    shotsAgainst: source.shotsAgainst,
    goalsAgainst: source.goalsAgainst,
    saves: source.saves,
    savePercent: source.savePercent,
    gaa: source.gaa,
    goals: source.goals,
    assists: source.assists,
    shutouts: source.shutouts,
    pim: entry.goaliePim ?? source.pim,
    ice: source.ice || (entry.goalieIceMinutes === undefined ? undefined : formatMinutes(entry.goalieIceMinutes))
  };
  let changed = false;
  Object.entries(values).forEach(([field, value]) => {
    if (value === undefined || value === null || String(value) === '') return;
    if (String(stats[field] ?? '') !== String(value)) changed = true;
    stats[field] = value;
  });
  return changed;
}

const protectedFields = ['powerPlay', 'shortHanded', 'opponentPenaltyTotal', 'assists', 'faceoffsTotal', 'mmPoints', 'highlights'];
const audit = { matches: [], skippedPlayers: [], protectedFieldChanges: [] };
for (const record of archiveState.value) {
  const data = sources.get(String(record?.date || '').slice(0, 10));
  if (!data || !record?.sheet) continue;
  let changedPlayers = 0;
  for (const entry of data.players || []) {
    const player = rosterPlayerFor(record, entry);
    if (!player) { audit.skippedPlayers.push(`${record.date}: ${entry.name}`); continue; }
    const state = record.sheet.players?.[player.id];
    if (!state) { audit.skippedPlayers.push(`${record.date}: ${entry.name} (нет в листе)`); continue; }
    const protectedBefore = JSON.stringify(Object.fromEntries(protectedFields.map(field => [field, state[field]])));
    const changed = entry.role === 'goalie' ? restoreGoalie(state, entry) : restoreSkater(state, entry);
    const protectedAfter = JSON.stringify(Object.fromEntries(protectedFields.map(field => [field, state[field]])));
    if (protectedBefore !== protectedAfter) audit.protectedFieldChanges.push(`${record.date}: ${player.name}`);
    if (changed) changedPlayers += 1;
  }
  record.sheet.khlStatsImportedAt = String(data.updatedAt || new Date().toISOString());
  record.sheet.khlStatsVersion = 2;
  record.updatedAt = new Date().toISOString();
  audit.matches.push({ date: record.date, opponent: record.opponent, khlPlayers: (data.players || []).length, changedPlayers });
}
if (audit.protectedFieldChanges.length) throw new Error(`Protected manual fields changed: ${audit.protectedFieldChanges.join(', ')}`);
archiveState.updatedAt = new Date().toISOString();
fs.writeFileSync(outputPath, JSON.stringify(archiveState));
console.log(JSON.stringify(audit, null, 2));
