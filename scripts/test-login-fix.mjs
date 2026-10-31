import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) || null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { signIn, restoreSession, signOut } = await import('../src/lib/auth.js');
const { hasSessionId } = await import('../src/lib/db.js');

console.log('1. Testing wrong password...');
const wrong = await signIn('naimul@gmail.com', 'wrongpass');
assert.equal(wrong.user, null, 'Wrong password must return user: null');
assert.equal(hasSessionId(), false, 'Session must not exist after failed login');

console.log('2. Testing real credentials naimul@gmail.com / 1234...');
const right = await signIn('naimul@gmail.com', '1234');
assert.ok(right.user, 'Real login must succeed');
assert.equal(right.user.email, 'naimul@gmail.com');
assert.equal(right.user.role, 'AGENT');
assert.equal(hasSessionId(), true, 'Session must exist after successful login');

console.log('3. Testing restoreSession on page reload...');
const restored = await restoreSession();
assert.ok(restored, 'restoreSession must succeed');
assert.equal(restored.email, 'naimul@gmail.com');

console.log('4. Testing signOut...');
await signOut();
assert.equal(hasSessionId(), false, 'Session must not exist after signOut');

console.log('ALL REAL CHECKS PASSED SUCCESSFULLY!');
