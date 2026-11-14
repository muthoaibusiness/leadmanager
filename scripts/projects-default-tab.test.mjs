// AppContext.nav(): Projects from the nav opens Available Units on desktop and
// the project list on phones; every other page resets the tab to the list.
// The rule lives inline in nav(), so this checks the same expression.
//   node scripts/projects-default-tab.test.mjs
import assert from 'node:assert/strict';

const projTabFor = (view, phone) => (view === 'properties' && !phone ? 'units' : 'list');

assert.equal(projTabFor('properties', false), 'units', 'desktop: Projects opens Available Units');
assert.equal(projTabFor('properties', true), 'list', 'phone: Projects opens the list');
assert.equal(projTabFor('leads', false), 'list', 'other pages reset to list (desktop)');
assert.equal(projTabFor('leads', true), 'list', 'other pages reset to list (phone)');
console.log('projects-default-tab: ok');
