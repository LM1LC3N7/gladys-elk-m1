import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  credentialsHash,
  normalizeConfig,
  parseHost,
  parseNumbers,
  sessionKey,
} from '../src/config.js';
import { normalizeMemory } from '../src/store.js';

test('defaults: TLS 1.2 on 2601, area 1, Fahrenheit, disarming and outputs off', () => {
  const config = normalizeConfig({ host: '192.168.1.80' });
  assert.equal(config.connection, 'tls12');
  assert.equal(config.port, 2601);
  assert.deepEqual(config.areas, [1]);
  assert.equal(config.temperatureUnit, 'fahrenheit');
  assert.equal(config.allowDisarm, false);
  assert.equal(config.allowOutputs, false);
  assert.equal(normalizeConfig({ host: 'x', connection: 'plain' }).port, 2101);
  assert.equal(normalizeConfig({ host: 'x', connection: 'plain', port: '2102' }).port, 2102);
  assert.equal(normalizeConfig({ host: 'x:2700', port: 2102 }).port, 2700);
  assert.equal(normalizeConfig({ host: 'x', connection: 'weird' }).connection, 'tls12');
});

test('hosts, lists and kinds', () => {
  assert.deepEqual(parseHost('elks://m1xep.lan:2601/'), { host: 'm1xep.lan', port: 2601 });
  assert.deepEqual(parseHost('not a host'), { host: '' });
  const zones = parseNumbers('1-3, 7:motion; 12:temperature, 20:temperature, 300, x', 208, {
    kinds: ['opening', 'motion', 'temperature'],
  });
  assert.deepEqual(
    [...zones.numbers],
    [
      [1, undefined],
      [2, undefined],
      [3, undefined],
      [7, 'motion'],
      [12, 'temperature'],
    ],
  );
  assert.deepEqual(zones.errors, ['20:temperature', '300', 'x']);
  assert.deepEqual(parseNumbers('5:motion', 208).errors, ['5:motion'], 'no kind for outputs');
  assert.equal(parseNumbers('1,'.repeat(5000), 208).numbers.size, 1, 'bounded');
});

test('codes and fingerprints', () => {
  assert.equal(normalizeConfig({ user_code: '123456' }).code, '123456');
  assert.equal(normalizeConfig({ user_code: '12' }).codeInvalid, true);
  const fp = 'ab'.repeat(32);
  assert.equal(normalizeConfig({ certificate_fingerprint: fp }).pin, 'AB:'.repeat(31) + 'AB');
  assert.equal(normalizeConfig({ certificate_fingerprint: 'abc' }).pinInvalid, true);
});

test('the session key holds the credentials (memory only); a hash of refused ones is salted', () => {
  const a = normalizeConfig({ host: 'x', username: 'u', password: 'p' });
  const b = normalizeConfig({ host: 'x', username: 'u', password: 'q' });
  assert.notEqual(sessionKey(a), sessionKey(b));
  assert.equal(
    sessionKey(a),
    sessionKey(normalizeConfig({ host: 'x', username: 'u', password: 'p', zones: '1' })),
  );
  const salt = '0'.repeat(32);
  assert.notEqual(credentialsHash(a, salt), credentialsHash(b, salt));
  assert.notEqual(credentialsHash(a, salt), credentialsHash(a, '1'.repeat(32)));
  assert.doesNotMatch(credentialsHash(a, salt), /p/);
});

test('the memory of /data is repaired, own properties only, times capped', () => {
  const now = 1_000_000;
  const memory = normalizeMemory(
    JSON.parse(
      '{"codeStop":{"at":"bad"},"lastAttemptAt":9e15,"failures":99,"pins":{"h:1":"' +
        'aa'.repeat(32) +
        '","__proto__":{"x":1},"h:2":"bad"},"certChanged":{"place":"h:1","fingerprint":"zz"},' +
        '"loginRefused":{"place":"h:1","salt":"short","hash":"x"}}',
    ),
    now,
  );
  assert.deepEqual(memory.codeStop, { at: 0 }, 'a stop, even malformed, is kept');
  assert.equal(memory.lastAttemptAt, now);
  assert.equal(memory.failures, 20);
  assert.deepEqual(Object.keys(memory.pins), ['h:1']);
  assert.equal(memory.certChanged, null);
  assert.equal(memory.loginRefused, null);
  assert.equal({}.x, undefined, 'no prototype pollution');
  assert.deepEqual(normalizeMemory(null, now).pins, Object.create(null));
});
