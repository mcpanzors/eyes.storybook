/* eslint-disable */
window.localStorage = window.localStorage || {
  _storage: {},
  setItem: function (key, value) { return this._storage[key] = value.toString(); },
  getItem: function (key) { return this._storage.hasOwnProperty(key) ? this._storage[key] : undefined; },
  removeItem: function (key) { return delete this._storage[key]; },
  clear: function () { return this._storage = {}; }
};
