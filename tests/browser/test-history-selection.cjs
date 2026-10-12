const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function setup() {
  function node() {
    const classes = new Set();
    return {
      children: [], events: {}, textContent: '', checked: false, indeterminate: false,
      classList: {
        contains: name => classes.has(name),
        add: name => classes.add(name), remove: name => classes.delete(name),
        toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }
      },
      set innerHTML(value) { this.children = []; this.html = value; },
      get innerHTML() { return this.html; },
      appendChild(child) { this.children.push(child); },
      addEventListener(name, fn) { this.events[name] = fn; },
      focus() {}
    };
  }
  let entries = [
    {id: 'bbc', title: 'BBC News', url: 'https://bbc.example', lastVisited: Date.now()},
    {id: 'other', title: 'Other Page', url: 'https://other.example', lastVisited: Date.now() - 1}
  ];
  const deleted = [], alerts = [], confirmations = [];
  const elements = new Map(['historyManager','histListHeading','histList','histSelectAll','histSearchInput'].map(id => [id,node()]));
  const documentEvents = {};
  const document = {getElementById: id => elements.get(id), querySelectorAll: () => [], createElement: node,
    addEventListener(name, fn) { documentEvents[name] = fn; }};
  const window = {electronAPI: {
    historyGet: async () => ({success: true, data: {entries}}),
    historyDelete: async ({ids}) => {
      deleted.push([...ids]); entries = entries.filter(entry => !ids.includes(entry.id));
      return {success: true, data: {entries}};
    }
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../apps/browser/History.js'),'utf8'), {
    window, document, console, alert: message => alerts.push(message),
    confirm: message => {confirmations.push(message); return true;}
  });
  await window.History.openManager();
  return {history: window.History, elements, deleted, alerts, confirmations, documentEvents};
}

test('search clears hidden selection before Delete selected', async () => {
  const h = await setup();
  h.history.toggleSelectAll(true);
  assert.equal(h.elements.get('histSelectAll').checked, true);
  h.history.onSearchInput('BBC');
  assert.equal(h.elements.get('histList').children.length, 1);
  assert.equal(h.elements.get('histSelectAll').checked, false);
  assert.equal(h.elements.get('histList').children[0].children[0].checked, false);
  await h.history.deleteSelected();
  assert.equal(h.deleted.length, 0);
  assert.equal(h.confirmations.length, 0);
  assert.equal(h.alerts.length, 1);
});

test('selecting search results deletes only visible entries', async () => {
  const h = await setup();
  h.history.toggleSelectAll(true);
  h.history.onSearchInput('BBC');
  h.history.toggleSelectAll(true);
  await h.history.deleteSelected();
  assert.equal(h.deleted.length, 1);
  assert.equal(h.deleted[0].join(','), 'bbc');
  assert.equal(h.confirmations.length, 1);
});

test('clearing search removes selection rather than restoring old selection', async () => {
  const h = await setup();
  h.history.onSearchInput('BBC');
  h.history.toggleSelectAll(true);
  h.history.onSearchInput('');
  assert.equal(h.elements.get('histList').children.length, 2);
  assert.equal(h.elements.get('histSelectAll').checked, false);
  assert.equal(h.elements.get('histSelectAll').indeterminate, false);
  await h.history.deleteSelected();
  assert.equal(h.deleted.length, 0);
});

test('changing to a search with no results clears selection', async () => {
  const h = await setup();
  h.history.toggleSelectAll(true);
  h.history.onSearchInput('no matching entry');
  assert.equal(h.elements.get('histSelectAll').checked, false);
  await h.history.deleteSelected();
  assert.equal(h.deleted.length, 0);
});


test('closing and reopening History clears previous delete selection', async () => {
  const h = await setup();
  h.history.toggleSelectAll(true);
  h.history.closeManager();
  assert.equal(h.elements.get('historyManager').classList.contains('open'), false);
  await h.history.openManager();
  assert.equal(h.elements.get('histSelectAll').checked, false);
  for (const row of h.elements.get('histList').children) assert.equal(row.children[0].checked, false);
  await h.history.deleteSelected();
  assert.equal(h.deleted.length, 0);
  assert.equal(h.confirmations.length, 0);
});

test('reopening preserves search results but clears their selection', async () => {
  const h = await setup();
  h.history.onSearchInput('BBC');
  h.history.toggleSelectAll(true);
  h.history.closeManager();
  await h.history.openManager();
  assert.equal(h.elements.get('histList').children.length, 1);
  assert.equal(h.elements.get('histSelectAll').checked, false);
  h.history.toggleSelectAll(true);
  await h.history.deleteSelected();
  assert.equal(h.deleted[0].join(','), 'bbc');
});

test('Escape closes History and clears selection for next open', async () => {
  const h = await setup();
  await h.history.init();
  h.history.toggleSelectAll(true);
  h.documentEvents.keydown({key: 'Escape'});
  await h.history.openManager();
  assert.equal(h.elements.get('histSelectAll').checked, false);
  await h.history.deleteSelected();
  assert.equal(h.deleted.length, 0);
});
