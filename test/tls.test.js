// The secure port against a REAL loopback TLS server with self-signed
// certificates (test/helpers/selfSigned.js): the certificate pinned at first
// use, the password sent only on a connection whose certificate matched the
// pin, another certificate stopping everything (nothing written to it) until
// the user vouches for it in two clicks or by typing its fingerprint, a
// refused login stopping for good until new credentials or a test click.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:tls';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ElkApp } from '../src/app.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import { FakeElk, quietLogger, settle, until } from './helpers/fakeElk.js';
import { selfSigned } from './helpers/selfSigned.js';

const CERT = selfSigned();
const OTHER = selfSigned('impostor.lan');
const USERNAME = 'elkuser';
const PASSWORD = 'pass-Word-42';

const panel = new FakeElk();
const login = { username: USERNAME, password: PASSWORD, refuse: false };
let server;
let port;

before(async () => {
  server = createServer({ key: CERT.key, cert: CERT.cert }, (socket) => panel.serve(socket, login));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** The certificate the server shows from now on. */
const showCertificate = (pair) => server.setSecureContext({ key: pair.key, cert: pair.cert });

async function setup(t, { config = {}, store = memoryStore() } = {}) {
  const gladys = createFakeGladys({
    config: {
      host: '127.0.0.1',
      port,
      connection: 'tls12',
      username: USERNAME,
      password: PASSWORD,
      user_code: '1234',
      language: 'en',
      ...config,
    },
  });
  const logger = quietLogger();
  const app = new ElkApp({ gladys, logger, store });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  t.after(() => app.stop({ final: true }));
  return { gladys, app, logger, store, status: () => gladys.fake.connectionStatus };
}

const ok = (ack) => assert.equal(ack?.success, true, ack?.error);
const fails = (ack, expected) => {
  assert.equal(ack?.success, false, 'the handler should have failed');
  if (expected) assert.match(ack.error, expected);
};

test('first use: the certificate is pinned, then the login and the panel', async (t) => {
  showCertificate(CERT);
  const sessions = panel.sessions.length;
  const ctx = await setup(t);
  await until(() => ctx.app.online);
  assert.equal(ctx.store.data.pins[`127.0.0.1:${port}`], CERT.fingerprint256);
  const peer = panel.sessions[sessions];
  assert.deepEqual(peer.login, [USERNAME, PASSWORD]);
  assert.equal(ctx.status().connected, true);
  const logs = ctx.logger.lines.join('\n');
  assert.doesNotMatch(logs, new RegExp(PASSWORD), 'the password is never logged');
  assert.doesNotMatch(JSON.stringify(ctx.store.data), new RegExp(PASSWORD));
  // Commands work over TLS.
  const area = ctx.gladys.externalIds('area', '1');
  const device = ctx.gladys.fake.discoveredDevices.find((d) => d.external_id === area.device);
  const button = device.features.find((f) => f.external_id === area.feature('arm-stay'));
  ok(await ctx.gladys.fake.setValue(device, button, 1));
  assert.equal(panel.commands.at(-1).code, 'a2');
  panel.armed[0] = '0';
});

test('another certificate: nothing written, stopped until two clicks pin exactly it', async (t) => {
  const place = `127.0.0.1:${port}`;
  const store = memoryStore({ pins: { [place]: CERT.fingerprint256 } });
  showCertificate(OTHER);
  const sessions = panel.sessions.length;
  const ctx = await setup(t, { store });
  await until(() => ctx.store.data?.certChanged);
  await ctx.app.chain;
  assert.equal(ctx.store.data.certChanged.fingerprint, OTHER.fingerprint256);
  assert.equal(ctx.status().connected, false);
  assert.match(ctx.status().message.en, /not the one Gladys knows/);
  assert.ok(ctx.status().message.en.includes(OTHER.fingerprint256), 'the fingerprint is shown');
  await settle();
  // The server got the TLS connection, never a line (no user name, no password).
  for (const peer of panel.sessions.slice(sessions)) assert.deepEqual(peer.login, []);
  // No new try by itself, a save changes nothing, the test button says why.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const count = panel.sessions.length;
  await ctx.app.configUpdated(ctx.gladys.fake.config);
  fails(await ctx.gladys.fake.action('test_connection'), /not the one Gladys knows/);
  assert.equal(panel.sessions.length, count);
  // First click: the fingerprint to compare; second click: pinned and connected.
  const first = await ctx.gladys.fake.action('trust_certificate');
  ok(first);
  assert.match(JSON.stringify(first), /Press again within 60 s/);
  ctx.app.memory.lastAttemptAt = 0;
  ctx.app.client.closedAt = undefined;
  const second = await ctx.gladys.fake.action('trust_certificate');
  ok(second);
  assert.match(JSON.stringify(second), /trusted/);
  await until(() => ctx.app.online);
  assert.equal(ctx.store.data.pins[place], OTHER.fingerprint256);
  assert.equal(ctx.store.data.certChanged, null);
  assert.deepEqual(panel.sessions.at(-1).login, [USERNAME, PASSWORD]);
});

test('a typed fingerprint wins; another one says which the M1XEP shows', async (t) => {
  showCertificate(CERT);
  const ctx = await setup(t, { config: { certificate_fingerprint: OTHER.fingerprint256 } });
  await until(() => ctx.store.data?.certChanged);
  await ctx.app.chain;
  assert.match(ctx.status().message.en, /not the one whose fingerprint you typed/);
  assert.ok(ctx.status().message.en.includes(CERT.fingerprint256));
  // Typing the shown one connects.
  ctx.app.memory.lastAttemptAt = 0;
  ctx.app.client.closedAt = undefined;
  await ctx.app.configUpdated({
    ...ctx.gladys.fake.config,
    certificate_fingerprint: CERT.fingerprint256.toLowerCase().replaceAll(':', ''),
  });
  await until(() => ctx.app.online);
});

test('a refused login stops for good; new credentials or a test click try once', async (t) => {
  showCertificate(CERT);
  login.refuse = true;
  t.after(() => {
    login.refuse = false;
  });
  const ctx = await setup(t);
  await until(() => ctx.store.data?.loginRefused);
  await ctx.app.chain;
  assert.match(ctx.status().message.en, /refused the user name or the password/);
  assert.doesNotMatch(JSON.stringify(ctx.store.data), new RegExp(PASSWORD));
  const count = panel.sessions.length;
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(panel.sessions.length, count, 'no new try by itself');
  // The test button tries once (still refused).
  ctx.app.client.lastAttemptAt = Date.now() - 20_000;
  ctx.app.memory.lastAttemptAt = Date.now() - 20_000;
  ctx.app.client.closedAt = undefined;
  fails(await ctx.gladys.fake.action('test_connection'), /refused the user name/);
  assert.equal(panel.sessions.length, count + 1);
  // The same credentials saved again: nothing.
  await ctx.app.configUpdated(ctx.gladys.fake.config);
  assert.equal(panel.sessions.length, count + 1);
  // New credentials: the stop is lifted and the login works.
  login.refuse = false;
  login.password = `${PASSWORD}!`;
  t.after(() => {
    login.password = PASSWORD;
  });
  ctx.app.memory.lastAttemptAt = 0;
  ctx.app.client.closedAt = undefined;
  await ctx.app.configUpdated({ ...ctx.gladys.fake.config, password: `${PASSWORD}!` });
  await until(() => ctx.app.online);
  assert.equal(ctx.store.data.loginRefused, null, 'erased at the first login that works');
});
