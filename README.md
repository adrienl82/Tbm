# TBM Temps Reel

Application mobile (Kivy/Python) affichant les prochains passages de bus et
tram du reseau TBM (Bordeaux Metropole) en temps reel, avec recherche
d'arrets et arrets favoris.

## Source des donnees

TBM ne publie pas de veritable flux RSS. Les horaires temps reel sont
exposes par Bordeaux Metropole via le web service public **SIRI-Lite**
(JSON), documente sur
[transport.data.gouv.fr](https://transport.data.gouv.fr/datasets/offres-de-services-bus-tram-et-scolaire-au-format-gtfs-netex-gtfs-rt-siri-lite) :

- `stoppoints-discovery.json` : liste des ~5200 arrets du reseau
- `lines-discovery.json` : lignes (numero, nom, destinations)
- `stop-monitoring.json?MonitoringRef=<arret>` : prochains passages a un arret,
  rafraichi cote serveur toutes les 30 secondes

Ces services sont accessibles avec une cle publique partagee
(`AccountKey=opendata-bordeaux-metropole-flux-gtfs-rt`), sans inscription.
Toute la logique d'appel vit dans `tbm/api.py`.

## Architecture

```
tbm/            logique metier, independante de Kivy (facile a tester)
  api.py        client HTTP SIRI-Lite + cache disque des arrets/lignes
  models.py     Stop, Line, Passage (dataclasses)
  storage.py    persistance des arrets favoris (JSON local)
ui/             interface Kivy
  tbmapp.py     App + ecrans (recherche, tableau des passages, favoris)
  layout.kv     mise en page
main.py         point d'entree (a la racine pour Buildozer)
tests/          tests unitaires de tbm/ (API mockee, pas besoin de Kivy)
```

## Installation (developpement, Linux)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
```

## Lancer l'application

```bash
python main.py
```

## Lancer les tests

```bash
pytest
```

Les tests couvrent `tbm/` (parsing de l'API, cache, favoris) en mockant les
appels reseau : ils ne necessitent pas Kivy installe.

## Construire l'APK Android

Depuis Linux, avec [Buildozer](https://buildozer.readthedocs.io/) :

```bash
pip install buildozer
buildozer -v android debug
```

L'APK genere se trouve dans `bin/`. `buildozer.spec` declare la permission
`INTERNET` necessaire pour interroger l'API TBM.

Buildozer ne prend pas en charge iOS : un packaging iOS necessiterait
[kivy-ios](https://github.com/kivy/kivy-ios) sur macOS, non couvert ici.

## Fonctionnalites actuelles

- Recherche d'arret par nom
- Tableau des prochains passages (ligne, destination, heure) pour un arret,
  rafraichi automatiquement toutes les 30 s
- Ajout/retrait d'un arret aux favoris, ecran dedie pour y acceder vite

## Pistes d'evolution

- Geolocalisation pour proposer les arrets les plus proches
- Alertes/perturbations via `general-message.json`
- Positions des vehicules en temps reel sur une carte (`vehicles` GTFS-RT)
