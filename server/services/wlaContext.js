import { AsyncLocalStorage } from 'node:async_hooks';

export const wlaAls = new AsyncLocalStorage();

export function currentWlaSession() {
  return wlaAls.getStore() || null;
}

export function runWithWlaSession(session, fn) {
  return wlaAls.run(session, fn);
}
