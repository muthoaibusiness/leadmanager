// The Knowledge document sections a Playground turn retrieved, as recorded in
// trace.documents by trainer-core: an array of hits, { error } when the search
// failed, or absent when no search ran. Unlike used_item_ids (what the model
// says it used), this is what retrieval actually put in the prompt.

const SEP = ' › ';

export function retrievedDocs(docs) {
  if (docs == null) return { kind: 'none' };
  if (!Array.isArray(docs)) return { kind: 'error', error: String(docs.error || 'search failed') };
  if (!docs.length) return { kind: 'empty' };
  return {
    kind: 'hits',
    hits: docs.map((d) => {
      // Turns saved before titles were traced only carry the document id.
      const title = d.title || `Document ${d.document_id}`;
      const parts = d.section ? d.section.split(' > ') : ['(no heading)'];
      // A top-level heading usually repeats the title; show it once.
      if (parts[0] === title && parts.length > 1) parts.shift();
      return { key: d.id, label: [title, ...parts].join(SEP), score: Number(d.score ?? 0).toFixed(2) };
    }),
  };
}
