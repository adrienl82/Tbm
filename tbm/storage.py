"""Local persistence for the user's favorite stops."""

import json
from pathlib import Path
from typing import List, Union


class FavoritesStore:
    """Persists favorite stop references as a small JSON file on disk."""

    def __init__(self, path: Union[Path, str]):
        self.path = Path(path)

    def load(self) -> List[str]:
        if not self.path.exists():
            return []
        try:
            data = json.loads(self.path.read_text())
        except (json.JSONDecodeError, OSError):
            return []
        return list(dict.fromkeys(data.get("favorites", [])))

    def save(self, favorites: List[str]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({"favorites": list(dict.fromkeys(favorites))}))

    def add(self, stop_ref: str) -> List[str]:
        favorites = self.load()
        if stop_ref not in favorites:
            favorites.append(stop_ref)
            self.save(favorites)
        return favorites

    def remove(self, stop_ref: str) -> List[str]:
        favorites = [f for f in self.load() if f != stop_ref]
        self.save(favorites)
        return favorites

    def toggle(self, stop_ref: str) -> List[str]:
        favorites = self.load()
        if stop_ref in favorites:
            return self.remove(stop_ref)
        return self.add(stop_ref)
