// The hostile scenarios of review 1 (R1 to R11), against the real ElkApp
// with the SDK fake Gladys, the simulated panel, a real local TCP server and
// a real local TLS 1.0 server; kept as regression tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createTcpServer } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ElkApp } from '../src/app.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import { makeLine } from '../src/elk/frame.js';
import { FakeElk, quietLogger, settle, until } from './helpers/fakeElk.js';
import { selfSigned } from './helpers/selfSigned.js';

const BASE = {
  host: '192.0.2.40',
  connection: 'plain',
  user_code: '1234',
  areas: '1-2',
  zones: '1',
  language: 'en',
};

async function setup(t, { config = {}, prepare, store = memoryStore(), connect } = {}) {
  const gladys = createFakeGladys({ config: { ...BASE, ...config } });
  const panel = new FakeElk();
  prepare?.(panel);
  const logger = quietLogger();
  const app = new ElkApp({ gladys, logger, connect: connect ?? panel.connect, store });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  t.after(() => app.stop({ final: true }));
  const ids = (kind, n) => gladys.externalIds(kind, String(n));
  const device = (id) => gladys.fake.discoveredDevices.find((d) => d.external_id === id);
  return {
    gladys,
    panel,
    app,
    logger,
    store,
    ids,
    press: (kind, n, key, value = 1) => {
      const d = device(ids(kind, n).device);
      const f = d.features.find((x) => x.external_id === ids(kind, n).feature(key));
      return gladys.fake.setValue(d, f, value);
    },
  };
}
const synced = async (ctx) => {
  await until(() => ctx.app.online);
  await until(() => ctx.app.namesRead !== undefined);
  await ctx.app.chain;
  await settle();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('R1: a second arm (other area) never waits for the confirmation of the first', async (t) => {
  const ctx = await setup(t);
  await synced(ctx);
  // The panel takes area 1's arm silently (a zone open, a code without right…).
  ctx.panel.hold = (code, line) => code === 'a1' && line[4] === '1';
  const first = ctx.press('area', 1, 'arm-away');
  await sleep(300);
  const second = ctx.press('area', 2, 'arm-away');
  const a2 = await second;
  assert.equal(a2.success, true, a2.error);
  assert.equal(ctx.panel.armed[1], '1');
  const a1 = await first;
  assert.equal(a1.success, false);
  assert.match(a1.error, /without confirmation/);
  assert.deepEqual(
    ctx.panel.commands.map((c) => c.line.slice(2, 5)),
    ['a11', 'a12'],
  );
});

test('R1b: a double press on one area never says "too slow"', async (t) => {
  const ctx = await setup(t);
  await synced(ctx);
  ctx.panel.hold = (code) => code === 'a1';
  const first = ctx.press('area', 1, 'arm-away');
  await sleep(100);
  const second = ctx.press('area', 1, 'arm-away');
  const [a1, a2] = await Promise.all([first, second]);
  for (const ack of [a1, a2]) assert.match(ack.error, /without confirmation/);
  assert.equal(ctx.panel.commands.length, 2, 'both written (the same level lowers nothing)');
});

test('R2: an arm stay right after a disarm written but not applied yet still goes', async (t) => {
  const ctx = await setup(t, {
    config: { allow_disarm: true },
    prepare: (p) => {
      p.armed[0] = '1';
      p.armUp[0] = '4';
    },
  });
  await synced(ctx);
  // The panel applies the disarm 1.2 s after it got it.
  ctx.panel.hold = (code) => {
    if (code !== 'a0') return false;
    setTimeout(() => {
      ctx.panel.armed[0] = '0';
      ctx.panel.armUp[0] = '1';
      ctx.panel.pushArming();
    }, 1200);
    return true;
  };
  const disarm = ctx.press('area', 1, 'disarm');
  await until(() => ctx.panel.commands.some((c) => c.code === 'a0'));
  await sleep(50);
  const arm = ctx.press('area', 1, 'arm-stay');
  const [d, a] = await Promise.all([disarm, arm]);
  assert.equal(d.success, true, d.error);
  assert.equal(a.success, true, a.error);
  assert.deepEqual(
    ctx.panel.commands.map((c) => c.code),
    ['a0', 'a2'],
  );
  assert.equal(ctx.panel.armed[0], '2', 'armed stay at the end, never left disarmed');
});

test('R3: wrong code, never in logs, status, errors, /data, events; no loop; restart keeps the stop', async (t) => {
  const store = memoryStore();
  const CODE = '987654';
  const ctx = await setup(t, { config: { user_code: CODE, allow_disarm: true }, store });
  await synced(ctx);
  const acks = [];
  acks.push(await ctx.press('area', 1, 'arm-away'));
  acks.push(await ctx.press('area', 1, 'arm-stay'));
  acks.push(await ctx.gladys.fake.sceneAction('arm', { area: '1', mode: 'armed_away' }));
  acks.push(await ctx.gladys.fake.sceneAction('disarm', { area: '1' }));
  assert.equal(ctx.panel.commands.length, 1, 'once');
  assert.ok(acks.every((ack) => ack.success === false));
  await sleep(300);
  const everything = JSON.stringify({
    logs: ctx.logger.lines,
    statuses: ctx.gladys.fake.connectionStatuses,
    acks,
    data: store.data,
    events: ctx.gladys.fake.sceneEvents,
    states: ctx.gladys.fake.states,
  });
  assert.doesNotMatch(everything, /987654|0908070605|9.8.7.6.5.4/);
  // Restart with the same store: still stopped, nothing sent.
  const copy = memoryStore({ ...store.data, lastAttemptAt: 0 });
  const again = await setup(t, { config: { user_code: CODE }, store: copy });
  await synced(again);
  const ack = await again.press('area', 1, 'arm-away');
  assert.equal(ack.success, false);
  assert.equal(again.panel.commands.length, 0);
});

test('R4: hostile lines: huge line, garbage, NUL, bad checksum flood, decoders', async (t) => {
  const ctx = await setup(t);
  await synced(ctx);
  const sock = ctx.panel.current;
  const sessions = ctx.panel.sessions.length;
  sock.raw('A'.repeat(5_000_000));
  await settle();
  assert.ok(ctx.app.client.reader.partial.length <= 512, 'bounded');
  sock.raw('\r\n');
  // An AS with a hostile armed status: malformed, dropped.
  sock.send(makeLine('AS', `${'9'.repeat(8)}${'1'.repeat(8)}${'0'.repeat(8)}`));
  // An SD with control characters and high bits.
  sock.send(makeLine('SD', `01001\x80\x1b[31mEVIL\x07\x00name`));
  // A ZC for zone 999, a CC for output 0, an ST with letters.
  sock.send(makeLine('ZC', '9999'));
  sock.send(makeLine('CC', '0001'));
  sock.send(makeLine('ST', '0xx999'));
  await settle();
  assert.equal(ctx.app.online, true, 'still up after a few bad lines');
  // 60 bad checksums in a row: cut.
  for (let i = 0; i < 60; i += 1) sock.raw('0Dzz1234567800FF\r\n');
  await until(() => ctx.app.online === false, 2000);
  assert.ok(ctx.panel.sessions.length >= sessions);
  for (const s of ctx.gladys.fake.states) {
    if (s.state !== undefined) assert.ok(Number.isFinite(s.state), JSON.stringify(s));
    if (s.text !== undefined) {
      assert.ok(
        [...s.text].every((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f),
        'no control character in a text state',
      );
    }
  }
});

test('R5: flood of valid XK lines cuts the link, no crash', async (t) => {
  const ctx = await setup(t);
  await synced(ctx);
  const xk = makeLine('XK', '0000000000000000');
  ctx.panel.current.raw(`${xk}\r\n`.repeat(5000));
  await until(() => ctx.app.online === false, 2000);
});

test('R6: alarm with no AZ answer: zone null, never undefined/NaN; armed_vacation event', async (t) => {
  const ctx = await setup(t);
  await synced(ctx);
  ctx.panel.hold = (code) => code === 'az';
  ctx.panel.alarm[0] = '?';
  ctx.panel.pushArming();
  await until(() => ctx.gladys.fake.sceneEvents.some((e) => e.key === 'alarm_triggered'), 4000);
  ctx.panel.alarm[0] = '0';
  ctx.panel.armed[1] = '6';
  ctx.panel.armUp[1] = '4';
  ctx.panel.pushArming();
  await until(() => ctx.gladys.fake.sceneEvents.some((e) => e.key === 'armed'), 4000);
  const alarm = ctx.gladys.fake.sceneEvents.find((e) => e.key === 'alarm_triggered');
  assert.deepEqual(alarm.data, { area: 1, zone: null, kind: 'heat', fire: false });
  const armed = ctx.gladys.fake.sceneEvents.find((e) => e.key === 'armed');
  assert.deepEqual(armed.data, { area: 2, mode: 'armed_vacation', by_gladys: false });
  for (const e of ctx.gladys.fake.sceneEvents) {
    for (const v of Object.values(e.data)) {
      assert.notEqual(v, undefined);
      assert.ok(!Number.isNaN(v));
    }
  }
});

test('M3: a new alarm of the same kind after the first one ended is announced', async (t) => {
  const ctx = await setup(t);
  await synced(ctx);
  const alarms = () => ctx.gladys.fake.sceneEvents.filter((e) => e.key === 'alarm_triggered');
  ctx.panel.alarm[0] = '6';
  ctx.panel.pushArming();
  await until(() => alarms().length === 1);
  ctx.panel.alarm[0] = '0';
  ctx.panel.pushArming();
  await sleep(50);
  await ctx.app.chain;
  ctx.panel.alarm[0] = '6';
  ctx.panel.pushArming();
  await until(() => alarms().length === 2);
});

test('R7: disarm turned off while the disarm waits in the queue: never written', async (t) => {
  const ctx = await setup(t, {
    config: { allow_disarm: true },
    prepare: (p) => (p.armed[0] = '1'),
  });
  await synced(ctx);
  let held = true;
  ctx.panel.hold = (code) => code === 'ss' && held;
  // Occupy the line with an internal read.
  ctx.app.client.read('troubles', [], { expect: 'SS', timeout: 2000, short: true }).catch(() => {});
  const d = ctx.press('area', 1, 'disarm');
  await sleep(100);
  await ctx.gladys.fake.configUpdated({ ...BASE, allow_disarm: false });
  held = false;
  const ack = await d;
  assert.equal(ack.success, false);
  assert.match(ack.error, /disabled in the configuration/);
  assert.equal(ctx.panel.commands.filter((c) => c.code === 'a0').length, 0);
});

test('R8: real TCP server on the plain port (default connect): works, one connection', async (t) => {
  const panel = new FakeElk();
  let connections = 0;
  const server = createTcpServer((socket) => {
    connections += 1;
    const peer = {
      session: connections,
      send: (line) => socket.write(`${line}\r\n`),
      raw: (text) => socket.write(text),
      destroy: () => socket.destroy(),
    };
    panel.sessions.push(peer);
    let buf = '';
    socket.on('data', (c) => {
      buf += c.toString('latin1');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (line) panel.receive(peer, line);
      }
    });
    socket.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const port = server.address().port;
  const gladys = createFakeGladys({
    config: { ...BASE, host: `127.0.0.1:${port}` },
  });
  const logger = quietLogger();
  const app = new ElkApp({ gladys, logger, store: memoryStore() });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  t.after(() => app.stop({ final: true }));
  await until(() => app.online);
  const area = gladys.externalIds('area', '1');
  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === area.device);
  const f = device.features.find((x) => x.external_id === area.feature('arm-away'));
  const ack = await gladys.fake.setValue(device, f, 1);
  assert.equal(ack.success, true, ack.error);
  assert.equal(connections, 1);
  // Server drops; an arm during the back-off wait: one attempt now.
  for (const s of panel.sessions) s.destroy();
  await until(() => !app.online);
  panel.armed[0] = '0';
  await sleep(5200);
  const ack2 = await gladys.fake.setValue(device, f, 1);
  assert.equal(ack2.success, true, ack2.error);
  assert.equal(connections, 2, 'one immediate attempt, never a second socket');
});

test('R9: TLS 1.0 option against a real TLS 1.0 server', async (t) => {
  const CERT = selfSigned();
  const panel = new FakeElk();
  const server = createTlsServer(
    {
      key: CERT.key,
      cert: CERT.cert,
      minVersion: 'TLSv1',
      maxVersion: 'TLSv1',
      ciphers: 'DEFAULT:@SECLEVEL=0',
    },
    (socket) => panel.serve(socket, { username: 'u', password: 'p' }),
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const port = server.address().port;
  const gladys = createFakeGladys({
    config: {
      ...BASE,
      host: '127.0.0.1',
      port,
      connection: 'tls10',
      username: 'u',
      password: 'p',
    },
  });
  const logger = quietLogger();
  const app = new ElkApp({ gladys, logger, store: memoryStore() });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  t.after(() => app.stop({ final: true }));
  await until(() => app.online, 4000);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('R10: a scene arm away while the area arms stay (exit timer): refused, nothing sent', async (t) => {
  const ctx = await setup(t, {
    prepare: (p) => {
      p.armed[0] = '2';
      p.armUp[0] = '3';
    },
  });
  await synced(ctx);
  const ack = await ctx.gladys.fake.sceneAction('arm', { area: '1', mode: 'armed_away' });
  // The panel arms a disarmed area only.
  assert.equal(ack.success, false);
  assert.match(ack.error, /another mode/);
  assert.equal(ctx.panel.commands.length, 0);
});

test('R11: ElkRP connected, link cut before RP 00: commands after the reconnection', async (t) => {
  const ctx = await setup(t);
  await synced(ctx);
  ctx.panel.current.send(makeLine('RP', '01'));
  await sleep(50);
  assert.equal(ctx.app.model.rp, 1);
  ctx.app.client.closedAt = undefined;
  ctx.panel.drop();
  await until(() => !ctx.app.online);
  // Reconnect quickly (test only).
  ctx.app.client.stop();
  ctx.app.client.start({ notBefore: 0, failures: 0 });
  await until(() => ctx.app.online, 8000);
  await ctx.app.chain;
  const ack = await ctx.press('area', 1, 'arm-away');
  assert.equal(ack.success, true, ack.error);
  assert.equal(ctx.app.model.rp, 0, 'ElkRP never outlives its session');
});

test('M5 (review 2): an arm waiting for a disarm never delays the arm of another area', async (t) => {
  const ctx = await setup(t, {
    config: { allow_disarm: true },
    prepare: (p) => {
      p.armed[0] = '1';
      p.armUp[0] = '4';
    },
  });
  await synced(ctx);
  // The disarm of area 1 is taken, never applied.
  ctx.panel.hold = (code) => code === 'a0';
  const disarm = ctx.press('area', 1, 'disarm');
  await until(() => ctx.panel.commands.some((c) => c.code === 'a0'));
  const asked = Date.now();
  const stay1 = ctx.press('area', 1, 'arm-stay');
  await sleep(100);
  const stay2 = ctx.press('area', 2, 'arm-stay');
  const a2 = await stay2;
  assert.equal(a2.success, true, a2.error);
  const written = ctx.panel.commands.find((c) => c.line.slice(2, 5) === 'a22');
  assert.ok(written, 'area 2 armed');
  assert.ok(written.at - asked < 1_500, `area 2 written at ${written.at - asked} ms`);
  const a1 = await stay1;
  assert.match(a1.error, /state is uncertain/);
  assert.equal(
    ctx.panel.commands.filter((c) => c.line.slice(2, 5) === 'a21').length,
    0,
    'area 1 still armed away: never lowered',
  );
  await disarm;
});
