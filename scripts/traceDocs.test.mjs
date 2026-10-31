// node --test scripts/traceDocs.test.mjs — what the Playground shows for the
// Knowledge sections a turn retrieved (trace.documents).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retrievedDocs } from '../src/lib/traceDocs.js';

const hit = (o) => ({ id: 'c', document_id: 'd1', version: 1, chunk_no: 1, title: 'Nuznan fact sheet', section: 'Wecon Nuznan > Apartment size', score: 0.612, ...o });

test('no search ran (older turn or no indexed documents): nothing to show', () => {
  assert.deepEqual(retrievedDocs(undefined), { kind: 'none' });
  assert.deepEqual(retrievedDocs(null), { kind: 'none' });
});

test('a search that found nothing is shown as such, not hidden', () => {
  assert.deepEqual(retrievedDocs([]), { kind: 'empty' });
});

test('a failed search shows the reason', () => {
  assert.deepEqual(retrievedDocs({ error: 'embedding provider 503' }), { kind: 'error', error: 'embedding provider 503' });
});

test('hits keep their order and show source, section and score', () => {
  const v = retrievedDocs([hit({ id: 'a', score: 0.71 }), hit({ id: 'b', title: undefined, document_id: 'd2', section: null, score: 0.4 })]);
  assert.equal(v.kind, 'hits');
  assert.deepEqual(v.hits, [
    { key: 'a', label: 'Nuznan fact sheet › Wecon Nuznan › Apartment size', score: '0.71' },
    // A turn saved before titles were traced, and a chunk with no heading.
    { key: 'b', label: 'Document d2 › (no heading)', score: '0.40' },
  ]);
});

test('the section path does not repeat the document title', () => {
  const v = retrievedDocs([hit({ title: 'WECON sales offices', section: 'WECON sales offices > Chattogram' })]);
  assert.equal(v.hits[0].label, 'WECON sales offices › Chattogram');
});
