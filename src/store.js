// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container):
// - the stop after the panel refused the user code, so a restart never sends
//   a refused code again (wrong codes may lock the keypads or be reported to
//   the alarm monitoring company);
// - the instant of the last connection attempt and how many failed in a
//   row, so a container restarting in a loop never connects faster than the
//   waits between attempts (written at most once a minute);
// - the SHA-256 fingerprint of the certificate of the M1XEP, per address
//   (not a secret: the M1XEP shows it to anyone), and the one of another
//   certificate met, which stops the connection until the user vouches for it;
// - after a refused login only, a salted SHA-256 of the refused user name and
//   password, so that a new one lifts the stop and the same one does not;
//   erased at the first login that works (never a fingerprint of a working
//   password).
// Never the user code, the password or anything derived from the code (a
// 4-digit code is brute-forced from any hash). The file is readable by the
// container user only (0600).
// -----------------------------------------------------------------------------

import { readFile, rename, writeFile } from 'node:fs/promises';
import { normalizeFingerprint } from './elk/client.js';
import { LIMITS } from './constants.js';

export const STATE_FILE = '/data/elk-m1-state.json';

export function fileStore(path = STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    async load() {
      try {
        const text = await readFile(path, 'utf8');
        // A state file is a few hundred bytes: anything big is not ours.
        return text.length > 16_384 ? null : JSON.parse(text);
      } catch {
        return null;
      }
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        await writeFile(temporary, text, { mode: 0o600 });
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

/** In-memory store, for the tests. */
export function memoryStore(initial = null) {
  let data = initial;
  let saves = 0;
  return {
    async load() {
      return data === null ? null : JSON.parse(JSON.stringify(data));
    },
    async save(next) {
      saves += 1;
      data = JSON.parse(JSON.stringify(next));
    },
    get data() {
      return data;
    },
    get saves() {
      return saves;
    },
  };
}

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** Own properties only: nothing comes from a prototype. */
const own = (object, key) =>
  object !== null &&
  typeof object === 'object' &&
  !Array.isArray(object) &&
  Object.hasOwn(object, key)
    ? object[key]
    : undefined;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const place = (value) => (typeof value === 'string' && value.length <= 300 ? value : undefined);

/**
 * The persisted state, repaired: { codeStop: { at } | null, lastAttemptAt,
 * failures, pins: { place: fingerprint }, certChanged: { place,
 * fingerprint, at } | null, loginRefused: { place, salt, hash, at } | null }.
 * Any code stop found, even malformed, is kept: a doubt never sends a refused
 * code again. A time read back is capped at `now`.
 */
export function normalizeMemory(raw, now = Date.now()) {
  const stop = own(raw, 'codeStop');
  const pins = Object.create(null);
  const rawPins = own(raw, 'pins');
  if (isObject(rawPins)) {
    for (const key of Object.keys(rawPins).slice(0, LIMITS.maxPins)) {
      const fingerprint = normalizeFingerprint(rawPins[key]);
      if (place(key) && fingerprint) pins[key] = fingerprint;
    }
  }
  const changed = own(raw, 'certChanged');
  const changedFingerprint = normalizeFingerprint(own(changed, 'fingerprint'));
  const refused = own(raw, 'loginRefused');
  const salt = own(refused, 'salt');
  const hash = own(refused, 'hash');
  return {
    codeStop: isObject(stop) ? { at: Math.min(finite(own(stop, 'at')), now) } : null,
    lastAttemptAt: Math.min(finite(own(raw, 'lastAttemptAt')), now),
    failures: Math.min(Math.max(0, Math.floor(finite(own(raw, 'failures')))), 20),
    pins,
    certChanged:
      place(own(changed, 'place')) && changedFingerprint
        ? {
            place: own(changed, 'place'),
            fingerprint: changedFingerprint,
            at: Math.min(finite(own(changed, 'at')), now),
          }
        : null,
    loginRefused:
      place(own(refused, 'place')) &&
      typeof salt === 'string' &&
      /^[0-9a-f]{32}$/.test(salt) &&
      typeof hash === 'string' &&
      /^[0-9a-f]{64}$/.test(hash)
        ? {
            place: own(refused, 'place'),
            salt,
            hash,
            at: Math.min(finite(own(refused, 'at')), now),
          }
        : null,
  };
}
