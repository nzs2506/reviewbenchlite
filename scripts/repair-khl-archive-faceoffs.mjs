#!/usr/bin/env node
/*
 * Repairs missing KHL faceoff and penalty values in a Cloudflare state wrapper.
 *
 * Usage:
 * node scripts/repair-khl-archive-faceoffs.mjs <archive.json> <output.json> \
 *   2026-09-07=<ak-bars-cache.json> ...
 *
 * Only empty columns are filled. Existing manual sheet values are retained.
 */
import fs from 'node:fs';

const [archivePath, outputPath, ...sourceArgs] = process.argv.slice(2);
if (!archivePath || !outputPath || !sourceArgs.length) {
  throw new Error('Usage: node scripts/repair-khl-archive-faceoffs.mjs <archive.json> <output.json> YYYY-MM-DD=<khl-cache.json> [...]');
}

const number = value => Math.max(0, Math.round(Number(value) || 0));
const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const sources = new Map(sourceArgs.map(arg => {
  const separator = arg.indexOf('=');
  if (separator < 1) throw new Error(`Invalid source: ${arg}`);
  return [arg.slice(0, separator), read(arg.slice(separator + 1))];
}));
const archiveState = read(archivePath);
if (!Array.isArray(archiveState?.value)) throw new Error('Expected a Cloudflare state wrapper with an array in value');

function playerForEntry(record, entry) {
  const role = String(entry?.role || 'forward');
  const numberText = String(entry?.number || '').trim();
  const name = String(entry?.name || '').trim().toLowerCase().replace(/ё/g, 'е');
  const eligible = (record.roster || []).filter(player => player.role === role);
  return eligible.find(player => String(player.number || '').trim() === numberText)
    || eligible.find(player => String(player.name || '').trim().toLowerCase().replace(/ё/g, 'е') === name)
    || null;
}

let repairedPlayers = 0;
const repairedMatches = [];
for (const record of archiveState.value) {
  const data = sources.get(String(record?.date || '').slice(0, 10));
  if (!data || !record?.sheet) continue;
  let changed = false;
  for (const entry of data.players || []) {
    if (entry?.role === 'goalie') continue;
    const player = playerForEntry(record, entry);
    if (!player) continue;
    const state = record.sheet.players?.[player.id];
    if (!state) continue;
    const faceoffTotal = number(entry.faceoffs);
    const faceoffWins = Math.min(faceoffTotal, number(entry.faceoffWins));
    const existingFaceoffs = [...(state.faceoffWins || []), ...(state.faceoffLosses || [])]
      .reduce((sum, value) => sum + number(value), 0);
    if (!existingFaceoffs && faceoffTotal) {
      state.faceoffWins = [faceoffWins, 0, 0];
      state.faceoffLosses = [Math.max(0, faceoffTotal - faceoffWins), 0, 0];
      state.faceoffsTotal = '';
      changed = true;
      repairedPlayers += 1;
    }
    const existingPim = (state.penalties || []).reduce((sum, value) => sum + number(value), 0);
    if (!existingPim && number(entry.pim)) {
      state.penalties = [number(entry.pim), 0, 0];
      changed = true;
    }
  }
  record.sheet.khlStatsVersion = 2;
  if (changed) {
    record.updatedAt = new Date().toISOString();
    repairedMatches.push(`${record.date} ${record.opponent}`);
  }
}

archiveState.updatedAt = new Date().toISOString();
fs.writeFileSync(outputPath, JSON.stringify(archiveState));
console.log(JSON.stringify({ repairedMatches, repairedPlayers }, null, 2));
