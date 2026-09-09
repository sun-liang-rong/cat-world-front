const Module = require('module');

const values = new Map();
const localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
  clear() { values.clear(); },
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'cc') return { sys: { localStorage } };
  return originalLoad.call(this, request, parent, isMain);
};
