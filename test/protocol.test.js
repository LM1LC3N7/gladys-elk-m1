// The framing and the messages, against the vectors of elkm1-lib's own tests
// (test_message.py, test_area.py, test_zone.py, test_thermostat.py).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LineReader, checksum, makeLine, parseLine } from '../src/elk/frame.js';
import {
  REQUEST,
  areaStatus,
  armLine,
  decode,
  isUserCode,
  outputLine,
} from '../src/elk/protocol.js';

/** A report as the panel sends it: length, code, data, 00, checksum. */
const report = (code, data) => makeLine(code, data);
const decoded = (code, data) => {
  const frame = parseLine(report(code, data));
  assert.ok(frame, `${code} frame`);
  return decode(frame.code, frame.line).value;
};

test('requests: the encodings of elkm1-lib (its numbers from 0, ours from 1)', () => {
  const body = (line) => line.slice(0, -2);
  assert.equal(body(armLine('armed_night', 3, '4242')), '0Da4300424200');
  assert.equal(body(outputLine(43, false)), '09cf04300');
  assert.equal(body(outputLine(43, true)), '0Ecn0430000000');
  assert.equal(body(REQUEST.description(10, 43)), '0Bsd1004300');
  assert.equal(body(REQUEST.thermostat(7)), '08tr0700');
  assert.equal(body(REQUEST.arming()), '06as00');
  // The checksum makes the sum of every character 0 mod 256.
  for (const line of [armLine('disarmed', 1, '123456'), REQUEST.zones(), REQUEST.version()]) {
    let sum = 0;
    for (const char of line.slice(0, -2)) sum += char.charCodeAt(0);
    assert.equal((sum + Number.parseInt(line.slice(-2), 16)) % 256, 0);
    assert.ok(parseLine(line), line);
  }
  assert.equal(checksum('06as00'), REQUEST.arming().slice(-2));
});

test('a command line refuses what it should never send', () => {
  assert.throws(() => armLine('armed_away', 9, '1234'));
  assert.throws(() => armLine('armed_away', 1, '12'));
  assert.throws(() => armLine('armed_away', 1, '12a4'));
  assert.throws(() => armLine('armed_vacation', 1, '1234'));
  assert.throws(() => outputLine(0, true));
  assert.throws(() => outputLine(209, true));
  assert.equal(isUserCode('1234'), true);
  assert.equal(isUserCode('123456'), true);
  assert.equal(isUserCode('1234567'), false);
  assert.equal(isUserCode(1234), false);
});

test('bad lengths and checksums are refused (elkm1-lib vectors)', () => {
  assert.equal(parseLine('42CV01000990030'), undefined);
  assert.equal(parseLine('02CV01000990030'), undefined);
  assert.equal(parseLine('0DCV01000990042'), undefined);
  assert.equal(parseLine('a really really bad message'), undefined);
  assert.ok(parseLine('08XXtest28'), 'an unknown code with a good checksum');
  assert.equal(decode('XX', '08XXtest28').known, false);
});

test('AS, AZ, ZC, TR decode as elkm1-lib does', () => {
  const as = decoded('AS', '100000004000000030000000');
  const area1 = areaStatus(as.areas.get(1));
  assert.equal(area1.armedMode, 'armed_away');
  assert.equal(area1.alarm, 'fire');
  assert.equal(area1.exit, false);
  assert.equal(areaStatus(as.areas.get(2)).armedMode, 'disarmed');
  const az = decoded('AZ', `05:A0000${'0'.repeat(200)}`);
  assert.deepEqual([...az.alarms], [2, 3, 4]);
  assert.deepEqual(decoded('ZC', '001B'), {
    zone: 1,
    status: { logical: 'violated', physical: 'short' },
  });
  assert.deepEqual(decoded('TR', '0120072687500'), {
    thermostat: 1,
    mode: 'cool',
    hold: false,
    fan: 'auto',
    temperature: 72,
    heat: 68,
    cool: 75,
    humidity: 0,
  });
});

test('malformed reports decode to nothing (never a guess)', () => {
  assert.equal(decoded('AS', '1000000040000000300000'), undefined, 'short AS');
  assert.equal(decoded('AS', '900000004000000030000000'), undefined, 'armed status 9');
  assert.equal(decoded('ZS', 'Z'.repeat(208)), undefined);
  assert.equal(decoded('CS', '2'.repeat(208)), undefined);
  assert.equal(decoded('ZC', '000B'), undefined, 'zone 0');
  assert.equal(decoded('ZC', '001'), undefined);
  assert.equal(decoded('TR', '0190072687500'), undefined, 'mode 9');
  assert.equal(decoded('RP', '07'), undefined);
});

test('arming states: exit timer, entry delay, ready, levels', () => {
  const status = (armed, armUp, alarm) => areaStatus({ armed, armUp, alarm });
  assert.equal(status('1', '3', '0').mode, 'arming');
  assert.equal(status('2', '4', '1').mode, 'entry_delay');
  assert.equal(status('3', '4', '0').armedMode, 'armed_stay', 'stay instant');
  assert.equal(status('5', '4', '0').armedMode, 'armed_night', 'night instant');
  assert.equal(status('6', '4', '0').armedMode, 'armed_vacation');
  assert.equal(status('0', '1', '0').ready, true);
  assert.equal(status('0', '0', '0').notReady, true);
  assert.equal(status('0', '1', '6').alarm, 'burglar');
  assert.equal(status('0', '1', '2').alarm, undefined, 'abort delay is not an alarm yet');
  assert.ok(status('1', '4', '0').level > status('4', '4', '0').level);
  assert.ok(status('4', '4', '0').level > status('2', '4', '0').level);
});

test('IC carries the code digits as pairs; SD names are printable', () => {
  const ic = decoded('IC', '00000102030400001');
  assert.deepEqual(ic, { code: '001234', user: 0 });
  const sd = decoded('SD', `00005${String.fromCharCode(0xc6)}ront door      `);
  assert.deepEqual(sd, { type: 0, unit: 5, name: 'Front door' });
  assert.deepEqual(decoded('SS', `1${'0'.repeat(3)}1${'0'.repeat(29)}`).troubles, [
    'ac_fail',
    'low_battery',
  ]);
  assert.deepEqual(decoded('VN', '050210020046'), { m1: '5.2.16', xep: '2.0.70' });
});

test('the line reader: CR LF, LF, chunks, bounded, linear', () => {
  const lines = [];
  const drops = [];
  const reader = new LineReader({
    onLine: (line) => lines.push(line),
    onDrop: (why) => drops.push(why),
    max: 40,
  });
  reader.push('16XK');
  reader.push(Buffer.from('abc\r\n\r\nLogin successful\nUsername: \r\n'));
  assert.deepEqual(lines, ['16XKabc', 'Login successful', 'Username: ']);
  reader.push('x'.repeat(30));
  reader.push('y'.repeat(30));
  reader.push('zzz\r\nok\r\n');
  assert.deepEqual(drops, ['line too long']);
  assert.equal(lines.at(-1), 'ok', 'the rest of a long line is skipped, the next one read');
  // A flood without line ends stays bounded.
  const big = new LineReader({ onLine: () => undefined, onDrop: () => undefined });
  for (let i = 0; i < 1000; i += 1) big.push('a'.repeat(1000));
  assert.ok(big.partial.length <= 512);
});
