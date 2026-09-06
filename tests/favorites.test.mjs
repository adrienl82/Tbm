import assert from "node:assert/strict";
import { test } from "node:test";

import { FavoritesStore } from "../js/favorites.js";

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, value);
  }
}

test("starts empty", () => {
  const store = new FavoritesStore(new MemoryStorage());
  assert.deepEqual(store.load(), []);
});

test("add is idempotent", () => {
  const store = new FavoritesStore(new MemoryStorage());
  store.add("stop-1");
  store.add("stop-1");
  assert.deepEqual(store.load(), ["stop-1"]);
});

test("toggle adds then removes", () => {
  const store = new FavoritesStore(new MemoryStorage());
  store.toggle("stop-1");
  assert.deepEqual(store.load(), ["stop-1"]);
  store.toggle("stop-1");
  assert.deepEqual(store.load(), []);
});

test("load survives a corrupted entry", () => {
  const storage = new MemoryStorage();
  storage.setItem("tbm.favorites", "not json");
  const store = new FavoritesStore(storage);
  assert.deepEqual(store.load(), []);
});
