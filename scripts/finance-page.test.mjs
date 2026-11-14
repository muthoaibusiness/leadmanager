// vite-node scripts/finance-page.test.mjs
// pageOf (lib/finance.js): the Statements list a page at a time on phones.
import assert from 'node:assert/strict';
import { pageOf } from '../src/lib/finance.js';

const rows = Array.from({ length: 23 }, (_, i) => i);
assert.deepEqual(pageOf(rows, 0, 10), { page: 0, rows: rows.slice(0, 10) }, 'first page: 10 rows');
assert.deepEqual(pageOf(rows, 2, 10), { page: 2, rows: [20, 21, 22] }, 'last page: the remainder');
assert.deepEqual(pageOf(rows, 9, 10), { page: 2, rows: [20, 21, 22] }, 'a page past the end falls back to the last one');
assert.deepEqual(pageOf(rows, -1, 10), { page: 0, rows: rows.slice(0, 10) }, 'a negative page is the first');
assert.deepEqual(pageOf([], 3, 10), { page: 0, rows: [] }, 'an empty list has one empty page');
assert.deepEqual(pageOf(rows, 5, 0), { page: 0, rows }, 'size 0: not paged, every row');
console.log('finance-page: ok');
