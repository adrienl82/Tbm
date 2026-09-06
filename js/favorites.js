// Persists the user's favorite stop references in the browser (per-device,
// no account or backend needed).

const STORAGE_KEY = "tbm.favorites";

export class FavoritesStore {
  constructor(storage = null) {
    this.storage = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
  }

  load() {
    if (!this.storage) return [];
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      const favorites = raw ? JSON.parse(raw) : [];
      return Array.isArray(favorites) ? favorites : [];
    } catch {
      return [];
    }
  }

  save(favorites) {
    this.storage?.setItem(STORAGE_KEY, JSON.stringify([...new Set(favorites)]));
  }

  add(stopRef) {
    const favorites = this.load();
    if (!favorites.includes(stopRef)) {
      favorites.push(stopRef);
      this.save(favorites);
    }
    return favorites;
  }

  remove(stopRef) {
    const favorites = this.load().filter((ref) => ref !== stopRef);
    this.save(favorites);
    return favorites;
  }

  toggle(stopRef) {
    return this.load().includes(stopRef) ? this.remove(stopRef) : this.add(stopRef);
  }
}
