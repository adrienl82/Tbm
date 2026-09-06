"""Kivy UI for the TBM real-time bus/tram companion app."""

from pathlib import Path

from kivy.app import App
from kivy.clock import Clock
from kivy.lang import Builder
from kivy.properties import StringProperty
from kivy.uix.behaviors import ButtonBehavior
from kivy.uix.boxlayout import BoxLayout
from kivy.uix.screenmanager import Screen, ScreenManager

from tbm.api import TbmClient
from tbm.storage import FavoritesStore

KV_PATH = Path(__file__).with_name("layout.kv")
REFRESH_INTERVAL_SECONDS = 30  # matches TBM's own real-time refresh rate


class StopRow(ButtonBehavior, BoxLayout):
    stop_ref = StringProperty("")
    stop_name = StringProperty("")


class PassageRow(BoxLayout):
    line_code = StringProperty("")
    destination = StringProperty("")
    eta_text = StringProperty("")


class SearchScreen(Screen):
    def on_search_text(self, text):
        app = App.get_running_app()
        results_box = self.ids.results
        results_box.clear_widgets()
        for stop in app.client.search_stops(text):
            row = StopRow(stop_ref=stop.ref, stop_name=stop.name)
            row.bind(on_release=lambda _row, ref=stop.ref, name=stop.name: app.open_board(ref, name))
            results_box.add_widget(row)


class BoardScreen(Screen):
    stop_ref = StringProperty("")
    stop_name = StringProperty("")
    status_text = StringProperty("")

    _refresh_event = None

    def on_enter(self):
        self.refresh()
        self._refresh_event = Clock.schedule_interval(lambda _dt: self.refresh(), REFRESH_INTERVAL_SECONDS)
        self._update_favorite_label()

    def on_leave(self):
        if self._refresh_event is not None:
            self._refresh_event.cancel()
            self._refresh_event = None

    def refresh(self):
        app = App.get_running_app()
        try:
            passages = app.client.stop_monitoring(self.stop_ref)
        except Exception as exc:  # network hiccups or API errors must not crash the board
            self.status_text = f"Erreur : {exc}"
            return

        self.status_text = "" if passages else "Aucun passage prevu pour le moment"
        passages_box = self.ids.passages
        passages_box.clear_widgets()
        for passage in passages:
            eta = passage.best_time
            eta_text = eta.astimezone().strftime("%H:%M") if eta else "?"
            passages_box.add_widget(
                PassageRow(line_code=passage.line_code, destination=passage.destination, eta_text=eta_text)
            )

    def toggle_favorite(self):
        App.get_running_app().favorites.toggle(self.stop_ref)
        self._update_favorite_label()

    def _update_favorite_label(self):
        app = App.get_running_app()
        is_favorite = self.stop_ref in app.favorites.load()
        self.ids.favorite_button.text = "★ Favori" if is_favorite else "☆ Ajouter aux favoris"


class FavoritesScreen(Screen):
    def on_enter(self):
        self.refresh()

    def refresh(self):
        app = App.get_running_app()
        favorites_box = self.ids.favorites
        favorites_box.clear_widgets()
        favorite_refs = app.favorites.load()
        if not favorite_refs:
            return
        stops_by_ref = {stop.ref: stop for stop in app.client.list_stops()}
        for ref in favorite_refs:
            name = stops_by_ref[ref].name if ref in stops_by_ref else ref
            row = StopRow(stop_ref=ref, stop_name=name)
            row.bind(on_release=lambda _row, r=ref, n=name: app.open_board(r, n))
            favorites_box.add_widget(row)


class TbmApp(App):
    title = "TBM Temps Reel"

    def build(self):
        self.client = TbmClient(cache_dir=Path(self.user_data_dir) / "cache")
        self.favorites = FavoritesStore(Path(self.user_data_dir) / "favorites.json")

        Builder.load_file(str(KV_PATH))
        self.manager = ScreenManager()
        self.manager.add_widget(SearchScreen(name="search"))
        self.manager.add_widget(BoardScreen(name="board"))
        self.manager.add_widget(FavoritesScreen(name="favorites"))
        return self.manager

    def open_board(self, stop_ref: str, stop_name: str):
        board = self.manager.get_screen("board")
        board.stop_ref = stop_ref
        board.stop_name = stop_name
        self.manager.current = "board"
