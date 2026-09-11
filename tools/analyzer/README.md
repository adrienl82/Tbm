# Analyzer — tableau de bord trafic TBM

Traite les sessions enregistrées par [`tools/record-feed.mjs`](../record-feed.mjs)
et produit un tableau de bord statique (`analysis/dashboard/index.html` +
`map.html`) : vitesse moyenne par heure (tram/bus), une carte de trafic par
créneau horaire, et un début de comparaison jour férié / vacances scolaires /
jour de semaine.

**Périmètre de cette version** : uniquement le trafic *observé* (positions,
vitesses, densité) + calendriers fériés/vacances. Pas encore de croisement
avec le GTFS statique (horaires théoriques, noms d'arrêts, ponctualité —
`trips.ndjson` a le nécessaire depuis le correctif du 2026-09-11, voir
`../README.md`), pas de détection d'incident/temps de reprise (a besoin de
plusieurs semaines de données pour une baseline). Volontairement laissé pour
plus tard — voir « Pour aller plus loin » en bas.

## Utiliser en local (contre une copie/un montage du Pi)

```bash
cd tools/analyzer
pip install -r requirements.txt
python run.py --data-dir R:\tbm        # ou le chemin de ton partage Samba monté
```

Ouvrir `<data-dir>/analysis/dashboard/index.html` dans un navigateur.

Options :

| option | rôle |
|---|---|
| `--data-dir <dir>` | requis — racine `session-*/` (le `--out` du recorder) |
| `--session <id>` | ne traiter qu'une session (ex. `session-20260910T0253`) |
| `--reprocess` | ignore les marqueurs `PROCESSED`, retraite tout |
| `--dashboard-only` | saute l'ingestion, reconstruit juste le tableau de bord depuis le parquet existant |

Chaque session est traitée une fois (marquée `PROCESSED` dans son dossier) ;
relancer `run.py` ne retraite que les nouvelles sessions puis reconstruit
toujours le tableau de bord à partir de tout le parquet accumulé.

## Comment ça marche

```
sessions.py     trouve les dossiers session-*/ (DONE, pas PROCESSED) + les
                vieux dossiers YYYY-MM-DD/ d'avant le 2026-09-10
calendars.py    jours feries + vacances scolaires Zone A (cache 7 jours)
ingest.py       charge vehicles/trips/alerts.ndjson(.gz) d'une session dans DuckDB
metrics.py      par session : metriques par course + grille spatiale 150m x 15min
store.py        ecrit analysis/parquet/{sessions,trips,grid}/<session>.parquet
rollups.py      agrege tout le parquet : vitesse/heure, comparaisons, carte
dashboard.py    genere index.html + map.html (donnees inlinees, aucun serveur requis)
run.py          orchestre tout ce qui precede
```

`ingest.py` utilise `read_ndjson(..., ignore_errors=true)` avec un schéma
explicite : un redémarrage en cours de session peut laisser une ligne
corrompue (observé une fois sur les 2 premiers jours, causé par un rebuild
d'add-on interrompant l'écriture) — DuckDB l'ignore plutôt que de faire
échouer toute la lecture.

Le tableau de bord est fait pour s'ouvrir tel quel (double-clic, ou via le
partage Samba) : pas de serveur, pas de `fetch()` — les données sont
inlinées dans le HTML en `<script>`, parce qu'une page `file://` ne peut pas
charger un JSON séparé de façon fiable selon les navigateurs.

## Pour aller plus loin (pas fait, pas nécessaire pour "voir")

- **GTFS statique** (`gtfsfeed/static/bordeaux`) : horaires théoriques, noms
  d'arrêts/lignes propres au lieu des ids bruts, ponctualité réelle
  (comparer `trips.ndjson` à l'horaire prévu).
- **Régularité / bunching** : intervalle entre véhicules d'une même ligne.
- **Détection d'incident + temps de reprise** : croiser `alerts.ndjson` avec
  une "santé" (vitesse + effectif de véhicules actifs, voir la validation du
  2026-09-11 sur l'incident Mériadeck-Sainte-Catherine) par rapport à une
  baseline glissante — a besoin d'au moins 2-3 semaines de sessions
  comparables pour qu'une baseline veuille dire quelque chose.
- **Semaine sur semaine** : `rollups.build_comparisons()` calcule déjà la
  structure : dès qu'il y a plusieurs semaines de sessions du même type de
  jour, la comparaison devient parlante sans changer le code.
- **Automatisation sur le Pi** : ce dossier tourne pour l'instant seulement
  en local. Une fois le tableau de bord jugé utile, l'empaqueter en 2ᵉ add-on
  HAOS (Python + DuckDB, cron nocturne + veille des `DONE`) comme prévu dans
  le plan initial -- pas fait tant qu'on n'a pas validé que le contenu vaut
  le coup.

## Note sur les tests

Pas de suite `pytest` pour l'instant : la vérification s'est faite en
conditions réelles (contre `R:\tbm`, 3 sessions dont une legacy) et en
inspectant visuellement le tableau de bord généré. À ajouter si ce code se
densifie (ex. la logique `session_date_service` autour du changement de jour
mériterait des cas de test explicites).
