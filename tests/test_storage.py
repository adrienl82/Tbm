from tbm.storage import FavoritesStore


def test_starts_empty(tmp_path):
    store = FavoritesStore(tmp_path / "favorites.json")
    assert store.load() == []


def test_add_is_idempotent(tmp_path):
    store = FavoritesStore(tmp_path / "favorites.json")
    store.add("stop-1")
    store.add("stop-1")
    assert store.load() == ["stop-1"]


def test_toggle_adds_then_removes(tmp_path):
    store = FavoritesStore(tmp_path / "favorites.json")
    store.toggle("stop-1")
    assert store.load() == ["stop-1"]
    store.toggle("stop-1")
    assert store.load() == []


def test_remove_missing_entry_is_a_noop(tmp_path):
    store = FavoritesStore(tmp_path / "favorites.json")
    store.remove("does-not-exist")
    assert store.load() == []


def test_load_survives_a_corrupted_file(tmp_path):
    path = tmp_path / "favorites.json"
    path.write_text("not json")
    store = FavoritesStore(path)
    assert store.load() == []
