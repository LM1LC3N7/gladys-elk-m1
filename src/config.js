// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { CONNECTIONS, DEFAULT_PORTS, LIMITS, TEMPERATURE_UNITS, ZONE_KINDS } from './constants.js';
import { normalizeFingerprint } from './elk/client.js';
import { isUserCode } from './elk/protocol.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  connection: 'tls12',
  areas: '1',
  temperature_unit: 'fahrenheit',
  allow_disarm: false,
  allow_outputs: false,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

const integer = (value, min, max) => {
  const text = String(value ?? '').trim();
  if (!/^\d{1,5}$/.test(text)) return undefined;
  const number = Number(text);
  return number >= min && number <= max ? number : undefined;
};

const choice = (value, options, fallback) => {
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  return options.includes(text) ? text : fallback;
};

/** `192.168.1.40`, `m1xep.lan:2601`, `elks://192.168.1.40` -> { host, port? }. */
export function parseHost(raw) {
  let text = String(raw ?? '').trim();
  text = text.replace(/^[a-z0-9_]+:\/\//i, '').replace(/\/.*$/, '');
  const match = /^(\[[0-9a-f:.]+\]|[^:\s]+)(?::(\d{1,5}))?$/i.exec(text);
  if (!match || text.length > 253) return { host: '' };
  const port = match[2] ? Number(match[2]) : undefined;
  return {
    host: match[1].replace(/^\[|\]$/g, ''),
    port: port >= 1 && port <= 65535 ? port : undefined,
  };
}

/**
 * `1-4, 7` -> sorted numbers within 1..max, with the entries not understood.
 * `kinds` (zones): `9:motion` gives a kind to a number or a range.
 */
export function parseNumbers(raw, max, { kinds } = {}) {
  const numbers = new Map();
  const errors = [];
  // Bounded: a configuration field is short; anything longer is cut.
  for (const entry of String(raw ?? '')
    .slice(0, 2000)
    .split(/[,;\n]+/)) {
    const text = entry.trim();
    if (text === '') continue;
    const match = /^(\d{1,3})(?:\s*-\s*(\d{1,3}))?(?:\s*[:=]\s*([a-z]+))?$/i.exec(text);
    const kind = match?.[3]?.toLowerCase();
    const from = Number(match?.[1]);
    const to = match?.[2] ? Number(match[2]) : from;
    const badKind = kind !== undefined && (!kinds || !kinds.includes(kind));
    // Zone temperatures exist for zones 1 to 16 only.
    const badTemperature = kind === 'temperature' && to > LIMITS.maxTemperatureZones;
    if (!match || from < 1 || to > max || to < from || badKind || badTemperature) {
      errors.push(text.slice(0, 40));
      continue;
    }
    for (let n = from; n <= to; n += 1) numbers.set(n, kind ?? numbers.get(n));
  }
  return { numbers: new Map([...numbers.entries()].sort(([a], [b]) => a - b)), errors };
}

/** The user code: 4 to 6 digits, '' when absent or malformed. */
export const normalizeCode = (raw) => {
  const text = String(raw ?? '').trim();
  return isUserCode(text) ? text : '';
};

export function normalizeConfig(raw = {}) {
  const { host, port: hostPort } = parseHost(raw?.host);
  const connection = choice(raw?.connection, CONNECTIONS, DEFAULTS.connection);
  const typedCode = String(raw?.user_code ?? '').trim();
  const typedPin = String(raw?.certificate_fingerprint ?? '').trim();
  const areas = parseNumbers(raw?.areas ?? DEFAULTS.areas, LIMITS.maxAreas);
  const zones = parseNumbers(raw?.zones, LIMITS.maxZones, { kinds: ZONE_KINDS });
  const outputs = parseNumbers(raw?.outputs, LIMITS.maxOutputs);
  const thermostats = parseNumbers(raw?.thermostats, LIMITS.maxThermostats);
  return {
    host,
    connection,
    tls: connection === 'plain' ? undefined : connection,
    // A port typed with the address wins over the port field, then the default.
    port: hostPort ?? integer(raw?.port, 1, 65535) ?? DEFAULT_PORTS[connection],
    username: String(raw?.username ?? '')
      .trim()
      .slice(0, 64),
    password: String(raw?.password ?? '').slice(0, 64),
    pin: normalizeFingerprint(typedPin),
    pinInvalid: typedPin !== '' && !normalizeFingerprint(typedPin),
    code: normalizeCode(typedCode),
    codeInvalid: typedCode !== '' && normalizeCode(typedCode) === '',
    areas: [...areas.numbers.keys()],
    zones: zones.numbers,
    outputs: [...outputs.numbers.keys()],
    thermostats: [...thermostats.numbers.keys()],
    listErrors: [...areas.errors, ...zones.errors, ...outputs.errors, ...thermostats.errors],
    temperatureUnit: choice(raw?.temperature_unit, TEMPERATURE_UNITS, DEFAULTS.temperature_unit),
    allowDisarm: bool(raw?.allow_disarm, DEFAULTS.allow_disarm),
    allowOutputs: bool(raw?.allow_outputs, DEFAULTS.allow_outputs),
    language: choice(raw?.language, LANGUAGES, DEFAULTS.language),
  };
}

/** The place of the panel: its pinned certificate and its stops belong to it. */
export const placeKey = (config) => `${config.host}:${config.port}`;

/**
 * What the session depends on: a change reconnects. The credentials are in
 * it (memory only, never logged nor written); the code and the lists are not.
 */
export const sessionKey = (config) =>
  JSON.stringify([
    config.host,
    config.port,
    config.connection,
    config.username,
    config.password,
    config.pin ?? null,
  ]);

/**
 * A salted fingerprint of a REFUSED user name and password, so that a new
 * one lifts the stop and the same one does not. Never kept for a login that
 * worked.
 */
export const credentialsHash = (config, salt) =>
  createHash('sha256')
    .update(`${salt}\u0000${config.username}\u0000${config.password}`)
    .digest('hex');
