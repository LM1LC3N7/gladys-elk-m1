// ElkApp with the SDK's fake Gladys (createFakeGladys) and the in-memory
// panel (test/helpers/fakeElk.js), on the non-secure port: the whole chain
// from the lines to the Gladys devices, states, scene events and commands.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ElkApp } from '../src/app.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import { FakeElk, quietLogger, settle, until } from './helpers/fakeElk.js';

const BASE = {
  host: '192.0.2.40',
  connection: 'plain',
  user_code: '1234',
  areas: '1-2',
  zones: '1, 2:motion, 3:temperature',
  outputs: '5',
  thermostats: '1',
  temperature_unit: 'fahrenheit',
  language: 'en',
};

async function setup(t, { config = {}, panel: panelOptions = {}, store, devices, prepare } = {}) {
  const gladys = createFakeGladys({ config: { ...BASE, ...config }, devices });
  const panel = new FakeElk(panelOptions);
  panel.names[1].set(1, 'House');
  panel.names[0].set(2, 'Hall motion');
  panel.thermostats.set(1, {
    mode: 1,
    hold: false,
    fan: false,
    temperature: 70,
    heat: 68,
    cool: 76,
    humidity: 40,
  });
  panel.temperatures[2] = 65;
  prepare?.(panel);
  const logger = quietLogger();
  const memory = store ?? memoryStore();
  const app = new ElkApp({ gladys, logger, connect: panel.connect, store: memory });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  t.after(() => app.stop({ final: true }));
  const device = (externalId) =>
    gladys.fake.discoveredDevices.find((d) => d.external_id === externalId);
  const ids = (kind, n) => gladys.externalIds(kind, String(n));
  return {
    gladys,
    panel,
    app,
    logger,
    store: memory,
    device,
    ids,
    state: (id) => gladys.fake.lastState(id),
    events: () => gladys.fake.sceneEvents,
    press: (kind, n, key, value = 1) => {
      const d = device(ids(kind, n).device);
      const feature = d.features.find((f) => f.external_id === ids(kind, n).feature(key));
      return gladys.fake.setValue(d, feature, value);
    },
  };
}

const up = async (ctx) => {
  await until(() => ctx.app.online);
  await ctx.app.chain;
  await settle();
};

/** Lets the initial reads (names, thermostats…) finish. */
const synced = async (ctx) => {
  await up(ctx);
  await until(() => ctx.app.namesRead !== undefined);
  await ctx.app.chain;
  await settle();
};

/** Lets a change reported by the panel reach Gladys. */
const flush = async (ctx) => {
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await ctx.app.chain;
  await settle();
};

const logs = (ctx) => ctx.logger.lines.join('\n');
const ok = (ack) => assert.equal(ack?.success, true, ack?.error);
const fails = (ack, expected) => {
  assert.equal(ack?.success, false, 'the handler should have failed');
  if (expected) assert.match(ack.error, expected);
};

test('start: devices with the panel names, read-only states, push buttons only', async (t) => {
  const ctx = await setup(t, { prepare: (panel) => (panel.zones[0] = '9') });
  await synced(ctx);
  const { gladys, ids } = ctx;
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => [d.external_id, d.name]),
    [
      [gladys.externalIds('panel', 'elk').device, 'ELK M1 panel'],
      [ids('area', 1).device, 'House'],
      [ids('area', 2).device, 'Area 2'],
      [ids('zone', 1).device, 'Zone 1'],
      [ids('zone', 2).device, 'Hall motion'],
      [ids('zone', 3).device, 'Zone 3'],
      [ids('output', 5).device, 'Output 5'],
      [ids('thermostat', 1).device, 'Thermostat 1'],
    ],
  );
  for (const d of gladys.fake.discoveredDevices) {
    for (const f of d.features) {
      assert.notEqual(f.category, 'switch', `${f.external_id}: never a switch`);
      if (f.read_only === false) {
        assert.deepEqual([f.category, f.type], ['button', 'push'], `${f.external_id}: a button`);
      }
    }
  }
  assert.equal(ctx.state(ids('area', 1).feature('mode')), 'Disarmed');
  assert.equal(ctx.state(ids('area', 1).feature('ready')), 1);
  // Zone 1: 0x9 = violated, open circuit.
  assert.equal(ctx.state(ids('zone', 1).feature('opening')), 0, 'open (core: 0)');
  assert.equal(ctx.state(ids('zone', 2).feature('motion')), 0);
  assert.equal(ctx.state(ids('zone', 3).feature('temperature')), 65);
  assert.equal(ctx.state(ids('output', 5).feature('state')), 0);
  assert.equal(ctx.state(ids('thermostat', 1).feature('temperature')), 70);
  assert.equal(ctx.state(ids('thermostat', 1).feature('heat-setpoint')), 68);
  assert.equal(ctx.state(ids('thermostat', 1).feature('humidity')), 40);
  assert.equal(ctx.state(ids('thermostat', 1).feature('thermostat-mode')), 'Heat');
  const thermostat = ctx.device(ids('thermostat', 1).device);
  assert.ok(
    thermostat.features.every((f) => f.read_only),
    'thermostats are read-only',
  );
  assert.equal(thermostat.features.find((f) => f.unit)?.unit, 'fahrenheit');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /ELK M1 panel \(M1 5\.2\.16\)/);
  assert.ok(gladys.fake.transports.every((entry) => entry.transport === 'local'));
});

test('reports become states and scene events (never undefined nor NaN)', async (t) => {
  const ctx = await setup(t);
  await synced(ctx);
  const { panel, ids } = ctx;
  panel.pushZone(1, '9');
  await flush(ctx);
  assert.equal(ctx.state(ids('zone', 1).feature('opening')), 0);
  // Armed away from a keypad: exit timer first, then armed.
  panel.armed[0] = '1';
  panel.armUp[0] = '3';
  panel.pushArming();
  await flush(ctx);
  assert.equal(ctx.state(ids('area', 1).feature('mode')), 'Arming');
  assert.equal(ctx.events().length, 0, 'no event during the exit timer');
  panel.armUp[0] = '4';
  panel.pushArming();
  await flush(ctx);
  assert.equal(ctx.state(ids('area', 1).feature('armed')), 1);
  assert.deepEqual(ctx.events().at(-1), {
    key: 'armed',
    data: { area: 1, mode: 'armed_away', by_gladys: false },
  });
  // A burglary in zone 1 of area 1.
  panel.zoneAlarms[0] = '4';
  panel.alarm[0] = '6';
  panel.pushArming();
  await until(() => ctx.events().at(-1).key === 'alarm_triggered');
  assert.deepEqual(ctx.events().at(-1), {
    key: 'alarm_triggered',
    data: { area: 1, zone: 1, kind: 'burglar', fire: false },
  });
  await flush(ctx);
  assert.equal(ctx.state(ids('area', 1).feature('alarm')), 1);
  assert.equal(ctx.state(ids('zone', 1).feature('alarm')), 1);
  // Fire in area 2, no configured zone in alarm there: zone null, never undefined.
  panel.alarm[1] = '3';
  panel.pushArming();
  await until(() => ctx.events().at(-1).data.kind === 'fire');
  assert.deepEqual(ctx.events().at(-1).data, { area: 2, zone: null, kind: 'fire', fire: true });
  panel.armed[0] = '0';
  panel.alarm[0] = '0';
  panel.alarm[1] = '0';
  panel.zoneAlarms[0] = '0';
  panel.pushArming();
  await flush(ctx);
  assert.deepEqual(ctx.events().at(-1), { key: 'disarmed', data: { area: 1, by_gladys: false } });
  for (const event of ctx.events()) {
    for (const value of Object.values(event.data)) {
      assert.notEqual(value, undefined);
      assert.ok(!Number.isNaN(value));
    }
  }
});

test('arm away: always allowed, decided on the state read now, confirmed by a later report', async (t) => {
  const ctx = await setup(t);
  await synced(ctx);
  const reads = ctx.panel.reads('as').length;
  ok(await ctx.press('area', 1, 'arm-away'));
  assert.equal(ctx.panel.commands.length, 1);
  assert.equal(ctx.panel.commands[0].line.slice(0, 11), '0Da11001234');
  assert.ok(ctx.panel.reads('as').length >= reads + 1, 'a read before');
  await flush(ctx);
  assert.deepEqual(ctx.events().at(-1), {
    key: 'armed',
    data: { area: 1, mode: 'armed_away', by_gladys: true },
  });
  // Already armed away: nothing sent; arm stay would lower it: nothing sent either.
  ok(await ctx.press('area', 1, 'arm-away'));
  ok(await ctx.press('area', 1, 'arm-stay'));
  assert.equal(ctx.panel.commands.length, 1);
  assert.doesNotMatch(logs(ctx), /1234/, 'the code is never logged');
  // Armed stay, then arm away asked: the panel arms a disarmed area only.
  ctx.panel.armed[1] = '2';
  ctx.panel.armUp[1] = '4';
  ctx.panel.pushArming();
  await flush(ctx);
  fails(await ctx.press('area', 2, 'arm-away'), /already armed in another mode: disarm it first/);
  assert.equal(ctx.panel.commands.length, 1);
});

test('an area not ready is not armed (nothing sent); the scene action arms', async (t) => {
  const ctx = await setup(t);
  await synced(ctx);
  ctx.panel.armUp[0] = '0';
  fails(await ctx.press('area', 1, 'arm-stay'), /not ready to arm/);
  assert.equal(ctx.panel.commands.length, 0);
  ctx.panel.armUp[0] = '1';
  ok(await ctx.gladys.fake.sceneAction('arm', { area: '1', mode: 'armed_night' }));
  assert.equal(ctx.panel.commands.at(-1).code, 'a4');
  fails(await ctx.gladys.fake.sceneAction('arm', { area: '3', mode: 'armed_away' }), /Area 3/);
  fails(await ctx.gladys.fake.sceneAction('arm', { area: '1', mode: 'armed_vacation' }));
  fails(await ctx.gladys.fake.sceneAction('arm', {}));
  assert.equal(ctx.panel.commands.length, 1);
});

test('disarm: off by default (nothing read, nothing sent); allowed: read, sent, confirmed', async (t) => {
  const ctx = await setup(t, { prepare: (panel) => (panel.armed[0] = '1') });
  await synced(ctx);
  const reads = ctx.panel.reads('as').length;
  fails(await ctx.press('area', 1, 'disarm'), /disabled in the configuration/);
  fails(await ctx.gladys.fake.sceneAction('disarm', { area: '1' }), /disabled/);
  assert.equal(ctx.panel.reads('as').length, reads);
  assert.equal(ctx.panel.commands.length, 0);
  await ctx.app.configUpdated({ ...BASE, allow_disarm: true });
  ok(await ctx.press('area', 1, 'disarm'));
  assert.equal(ctx.panel.commands.at(-1).line.slice(0, 11), '0Da01001234');
  await flush(ctx);
  assert.deepEqual(ctx.events().at(-1), { key: 'disarmed', data: { area: 1, by_gladys: true } });
  ok(await ctx.press('area', 1, 'disarm'));
  assert.equal(ctx.panel.commands.length, 1, 'already disarmed: nothing sent');
  // Switched off again: applies at once.
  await ctx.app.configUpdated({ ...BASE, allow_disarm: false });
  fails(await ctx.press('area', 1, 'disarm'), /disabled/);
});

test('a code reported invalid stops the commands, across restarts, until a click or a new code', async (t) => {
  const store = memoryStore();
  const ctx = await setup(t, { config: { user_code: '9999' }, store });
  await synced(ctx);
  fails(await ctx.press('area', 1, 'arm-away'), /refused the user code/);
  assert.equal(ctx.panel.commands.length, 1);
  assert.ok(store.data.codeStop, 'persisted');
  assert.doesNotMatch(JSON.stringify(store.data), /9999/, 'never the code in /data');
  fails(await ctx.press('area', 1, 'arm-away'), /refused this user code before/);
  assert.equal(ctx.panel.commands.length, 1, 'never sent again by itself');
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /refused the user code/);
  // A wrong code typed on a keypad is not ours.
  const other = await setup(t);
  await synced(other);
  other.panel.pushInvalidCode('1234');
  await flush(other);
  assert.equal(other.store.data?.codeStop ?? null, null);
  // The click lifts the stop: one new try.
  const message = await ctx.gladys.fake.action('allow_code_retry');
  ok(message);
  assert.match(JSON.stringify(message), /Nothing was sent now/);
  fails(await ctx.press('area', 1, 'arm-away'), /refused the user code/);
  assert.equal(ctx.panel.commands.length, 2);
  // A new code lifts it too.
  await ctx.app.configUpdated({ ...BASE, user_code: '1234' });
  ok(await ctx.press('area', 1, 'arm-away'));
  assert.equal(ctx.panel.commands.length, 3);
});

test('an arm withdraws a disarm of its area still waiting; it goes first', async (t) => {
  const ctx = await setup(t, {
    config: { allow_disarm: true },
    prepare: (panel) => {
      panel.armed[0] = '2';
      panel.armUp[0] = '4';
    },
  });
  await synced(ctx);
  // The first disarm holds the line (its read gets no answer for a while).
  let held = true;
  ctx.panel.hold = (code) => code === 'as' && held;
  const disarm1 = ctx.press('area', 1, 'disarm');
  await settle();
  const disarm2 = ctx.press('area', 1, 'disarm');
  await settle();
  held = false;
  const arm = ctx.press('area', 1, 'arm-away');
  const [a, d1, d2] = await Promise.all([arm, disarm1, disarm2]);
  fails(d2, /arming of this area was asked/);
  assert.ok(d1.success === false, 'the first disarm read nothing in time');
  // Armed stay already: arm away cannot go over it (the panel needs a disarm first).
  fails(a, /another mode/);
  assert.equal(ctx.panel.commands.filter((c) => c.code === 'a0').length, 0, 'no disarm sent');
});

test('outputs: off by default; allowed, decided on a fresh read, confirmed by CC', async (t) => {
  const ctx = await setup(t);
  await synced(ctx);
  fails(await ctx.press('output', 5, 'turn-on'), /outputs from Gladys is disabled/);
  assert.equal(ctx.panel.outputCommands.length, 0);
  await ctx.app.configUpdated({ ...BASE, allow_outputs: true });
  ok(await ctx.press('output', 5, 'turn-on'));
  assert.equal(ctx.panel.outputCommands.at(-1).line.slice(0, 14), '0Ecn0050000000');
  await flush(ctx);
  assert.equal(ctx.state(ctx.ids('output', 5).feature('state')), 1);
  ok(await ctx.press('output', 5, 'turn-on'));
  assert.equal(ctx.panel.outputCommands.length, 1, 'already on: nothing sent');
  ok(await ctx.press('output', 5, 'turn-off'));
  assert.equal(ctx.panel.outputCommands.at(-1).code, 'cf');
  fails(await ctx.press('output', 5, 'turn-on', 0), /Unexpected value/);
  fails(await ctx.press('output', 5, 'state'), /read-only/);
});

test('no report shows the command: "sent, without confirmation"', async (t) => {
  const ctx = await setup(t, { panel: { exitDelay: false } });
  await synced(ctx);
  ctx.panel.ignoreCommands = true;
  fails(
    await ctx.press('area', 1, 'arm-away'),
    /Sent to the panel \(arm away area 1\), without confirmation/,
  );
  assert.equal(ctx.panel.commands.length, 1);
});

test('restart loop: never a connection sooner than the last attempt allows; the test button reads nothing', async (t) => {
  const store = memoryStore({ codeStop: null, lastAttemptAt: Date.now() - 1_000, failures: 2 });
  const ctx = await setup(t, { store });
  await settle();
  assert.equal(ctx.panel.sessions.length, 0, 'waits ~30 s after two failures');
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /next try in (29|30) s/);
  fails(await ctx.gladys.fake.action('test_connection'), /next try in/);
  assert.equal(ctx.panel.sessions.length, 0);
});

test('an arm is never blocked by the waits between attempts: one attempt now', async (t) => {
  const store = memoryStore({ codeStop: null, lastAttemptAt: Date.now() - 1_000, failures: 4 });
  const ctx = await setup(t, { store });
  await settle();
  assert.equal(ctx.panel.sessions.length, 0);
  ok(await ctx.press('area', 1, 'arm-away'));
  assert.equal(ctx.panel.sessions.length, 1);
  assert.equal(ctx.panel.commands.length, 1);
});

test('a Gladys reconnection republishes status, devices and states without reading the panel', async (t) => {
  const ctx = await setup(t);
  await synced(ctx);
  const lines = ctx.panel.log.length;
  const statuses = ctx.gladys.fake.connectionStatuses.length;
  const discovered = ctx.gladys.fake.discoveredDevices;
  await ctx.app.connected(BASE);
  assert.equal(ctx.panel.log.length, lines, 'nothing read');
  assert.ok(ctx.gladys.fake.connectionStatuses.length > statuses, 'status sent again');
  assert.ok(ctx.gladys.fake.discoveredDevices.length >= discovered.length);
  // An unchanged configuration saved: no reconnection.
  await ctx.app.configUpdated(BASE);
  assert.equal(ctx.panel.sessions.length, 1);
  ok(await ctx.gladys.fake.action('test_connection'));
  assert.equal(ctx.panel.log.length, lines, 'the test button reads nothing');
});

test('a late report of an older session publishes nothing', async (t) => {
  const ctx = await setup(t);
  await synced(ctx);
  const old = ctx.panel.current;
  // (No wait before the new connection, for the test.)
  ctx.app.memory.lastAttemptAt = 0;
  ctx.app.client.closedAt = undefined;
  await ctx.app.configUpdated({ ...BASE, host: '192.0.2.41' });
  await up(ctx);
  const before = ctx.gladys.fake.states.length;
  ctx.panel.armed[0] = '1';
  // Bytes of the old socket, delivered late (whatever the socket state).
  old.emit('data', Buffer.from(`${ctx.panel.as()}\r\n`));
  await flush(ctx);
  assert.equal(
    ctx.gladys.fake.states.slice(before).filter((s) => s.text === 'Armed (away)').length,
    0,
  );
});
