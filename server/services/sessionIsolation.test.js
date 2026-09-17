import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  identifyUser,
  publicIdentity,
  filterPayloadForIdentity,
  createSession,
  getSession,
  persistSessions,
  deleteSession,
  ERIC_ID,
  BEN_ID,
  JADE_ID
} from './sessionStore.js';
import { runWithWlaSession } from './wlaContext.js';
import { getBlackbaudSession, portalTFromCookie, formatCookieString } from './blackbaudService.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('parents see both kids; students see self plus All calendar', () => {
  const payload = {
    grades: { Ben: [{ id: 1 }], Jade: [{ id: 2 }] },
    tasks: [{ student: 'Ben' }, { student: 'Jade' }],
    events: [{ student: 'Ben' }, { student: 'Jade' }, { student: 'All' }],
    assignments: [{ student: 'Ben' }, { student: 'Jade' }],
    missingAssignments: [{ student: 'Ben' }, { student: 'Jade' }]
  };
  const eric = identifyUser({ userId: ERIC_ID, accountName: 'Eric Smith', role: 'parent' });
  const stef = identifyUser({ firstName: 'Stefani', email: 'stefanicsmith@gmail.com', role: 'parent' });
  const ben = identifyUser({ userId: BEN_ID, accountName: 'Ben Smith', role: 'student' });
  const jade = identifyUser({ userId: JADE_ID, firstName: 'Jade', role: 'student' });

  assert.equal(eric.userKey, 'eric');
  assert.equal(stef.userKey, 'stefani');
  assert.deepEqual(eric.allowedStudentKeys, ['Ben', 'Jade']);
  assert.deepEqual(stef.allowedStudentKeys, ['Ben', 'Jade']);
  assert.equal(filterPayloadForIdentity(payload, eric), payload);
  assert.equal(filterPayloadForIdentity(payload, stef), payload);

  const benView = filterPayloadForIdentity(payload, ben);
  assert.deepEqual(Object.keys(benView.grades), ['Ben']);
  assert.deepEqual(benView.tasks.map((t) => t.student), ['Ben']);
  assert.deepEqual(benView.events.map((e) => e.student), ['Ben', 'All']);
  assert.deepEqual(benView.assignments.map((a) => a.student), ['Ben']);

  const jadeView = filterPayloadForIdentity(payload, jade);
  assert.deepEqual(Object.keys(jadeView.grades), ['Jade']);
  assert.deepEqual(jadeView.events.map((e) => e.student), ['Jade', 'All']);
});

test('public identity never includes cookie t', () => {
  const identity = publicIdentity({
    cookie: 't=secret-token-value',
    userKey: 'eric',
    displayName: 'Eric',
    role: 'parent',
    accountName: 'Eric Smith',
    allowedStudentKeys: ['Ben', 'Jade'],
    allowedStudentIds: [BEN_ID, JADE_ID],
    students: [{ id: BEN_ID, student: 'Ben' }, { id: JADE_ID, student: 'Jade' }]
  });
  const serialized = JSON.stringify(identity);
  assert.equal(identity.cookie, undefined);
  assert.equal(serialized.includes('secret-token-value'), false);
  assert.equal(serialized.includes('"t='), false);
});

test('ALS wlaContext keeps N concurrent session t values isolated', async () => {
  const jobs = Array.from({ length: 8 }, (_, i) => {
    const session = { cookie: `t=session-${i}`, userKey: `user${i}` };
    return runWithWlaSession(session, () => getBlackbaudSession());
  });
  const results = await Promise.all(jobs);
  results.forEach((live, i) => {
    assert.equal(live.cookie, `t=session-${i}`);
  });
});

test('session store is an unbounded map keyed by session id', () => {
  const ids = [];
  for (let i = 0; i < 6; i += 1) {
    ids.push(createSession({ cookie: `t=store-${i}`, userKey: `guest${i}` }));
  }
  assert.equal(new Set(ids).size, 6);
  ids.forEach((id, i) => {
    assert.equal(getSession(id).cookie, `t=store-${i}`);
  });
  assert.equal(getSession(ids[0]).cookie, 't=store-0');
  ids.forEach((id) => deleteSession(id));
});

test('Cookie header always carries harvested t', () => {
  assert.equal(portalTFromCookie('t=abc-token'), 'abc-token');
  assert.equal(portalTFromCookie('sd=1; t=abc-token; persona=parent'), 'abc-token');
  assert.equal(formatCookieString('abc-token-without-equals-prefix-xxx'), 't=abc-token-without-equals-prefix-xxx');
  assert.match(formatCookieString('sd=1; t=abc-token'), /t=abc-token/);
});

test('blackbaudService has no process-global cachedSession', () => {
  const src = readFileSync(path.join(here, 'blackbaudService.js'), 'utf8');
  assert.equal(/let cachedSession/.test(src), false);
  assert.equal(/saveBlackbaudSession/.test(src), false);
  assert.equal(/set\/blackbaud_session/.test(src), false);
});

test('session bind updates only the targeted wla_session row', () => {
  const idA = createSession({ subdomain: 'westlakelutheran', userKey: 'guestA' });
  const idB = createSession({ subdomain: 'westlakelutheran', userKey: 'guestB' });
  const rowA = getSession(idA);
  rowA.cookie = 't=token-for-a';
  persistSessions(rowA);
  assert.equal(getSession(idA).cookie, 't=token-for-a');
  assert.equal(getSession(idB).cookie, undefined);
  deleteSession(idA);
  deleteSession(idB);
});
