# Outils d'archivage / analyse du flux TBM

## `record-feed.mjs` — enregistrer une journée de trajets

Interroge le flux GTFS-RT « positions véhicules » de TBM (tout le réseau en
une requête, rafraîchi ~10-30 s) et écrit une ligne NDJSON par nouveau point
GPS de chaque véhicule. Prévu pour tourner une journée de service entière,
puis analyse hors-ligne.

```bash
npm install                 # une fois (récupère protobufjs)
node tools/record-feed.mjs  # Ctrl+C pour arrêter proprement
```

Options :

| option | défaut | rôle |
|---|---|---|
| `--interval <sec>` | `20` | délai entre deux relevés |
| `--out <dir>` | `data` | dossier racine de sortie |
| `--trips` | off | enregistre en plus le flux trip-updates (retard par course) |
| `--alerts` | off | enregistre en plus le flux perturbations (alertes) |
| `--raw` | off | garde aussi chaque réponse véhicules brute, gzippée (`raw/HHMMSS.pb.gz`) |
| `--once` | off | un seul relevé puis sortie (test rapide) |

Sortie (rotation automatique à minuit, heure locale) :

```
data/2026-09-09/
  vehicles-2026-09-09.ndjson    une ligne par point GPS (voir champs plus bas)
  trips-2026-09-09.ndjson       une ligne par course quand son retard bouge (--trips)
  alerts-2026-09-09.ndjson      une ligne par alerte à son apparition / changement (--alerts)
  raw/153201.pb.gz              --raw
  meta.json                     infos de run + compteurs
```

`data/` est dans `.gitignore` (gros volume, ~100-300 Mo/jour non compressé).

### Faire tourner en fond toute la journée

- **Raspberry Pi / Home Assistant OS** : add-on local clé en main dans
  [`hass-addon/`](hass-addon/) (démarrage au boot, watchdog, logs et config
  dans l'interface HA, gzip + purge automatiques). C'est l'option recommandée
  pour enregistrer tous les jours sans y penser.
- **VSCode** : lance-le dans un terminal intégré dédié et laisse-le ; il
  survit tant que la fenêtre est ouverte.
- **Windows, en tâche de fond** :
  ```powershell
  Start-Process node -ArgumentList 'tools/record-feed.mjs' -WindowStyle Hidden -RedirectStandardError data\record.log
  ```
  (arrêt : `Get-Process node | Stop-Process`, ou vise le PID noté au lancement)
- La reprise sur erreur est intégrée : une requête qui échoue est loggée et
  le poller continue. Après minuit il écrit dans un nouveau dossier daté.

### Champs d'une ligne `vehicles-*.ndjson`

| clé | sens |
|---|---|
| `rt` | horodatage du relevé par le poller (ISO 8601 UTC) |
| `ft` | horodatage du point GPS par le véhicule lui-même (`null` si absent) |
| `id` | identifiant véhicule (stable sur un trajet ; sinon l'id de course) |
| `label` | girouette / destination affichée |
| `trip` | id de course GTFS |
| `route` | id numérique de ligne (ex. `"08"`, `"1064"` ; voir `lineShapes.js`) |
| `dir` | sens `0` / `1` (`null` si absent) |
| `lat`, `lon` | position |
| `brg` | cap en degrés (`null` si absent) |
| `spd` | vitesse **en m/s**, brute du flux (`null` si absent) |
| `stop` | id de l'arrêt courant / suivant |
| `st` | statut : `0` = arrive à l'arrêt, `1` = à l'arrêt, `2` = en route |

Déduplication : une ligne n'est écrite que si le `ft` du véhicule est plus
récent que le dernier enregistré pour cet `id` — pas de doublon quand un
véhicule ne bouge pas entre deux relevés.

### Champs d'une ligne `trips-*.ndjson` (`--trips`)

Flux GTFS-RT trip-updates : la prédiction temps réel de chaque course en
service. Une ligne est écrite à la 1ʳᵉ observation d'une course, puis à chaque
fois que son retard (`delay_sec`) bouge d'au moins 30 s.

| clé | sens |
|---|---|
| `rt` | horodatage du relevé (ISO 8601 UTC) |
| `trip` | id de course GTFS (joint à `trips.txt` / `stop_times.txt` du GTFS statique) |
| `route` | id numérique de ligne |
| `dir` | sens `0` / `1` (`null` si absent) |
| `start_date` | date de service de la course (`YYYYMMDD`) |
| `delay_sec` | retard courant de la course en secondes (négatif = en avance) |
| `next_stop` | id du prochain arrêt (celui dont l'heure prévue est encore à venir) |
| `next_stop_seq` | rang de ce prochain arrêt dans la course |
| `next_time` | heure d'arrivée prévue à ce prochain arrêt (ISO 8601 UTC) |
| `sched_rel` | relation à l'horaire : `0` prévu, `1` supprimé, `2` ajouté, `3` course annulée |

### Champs d'une ligne `alerts-*.ndjson` (`--alerts`)

Flux GTFS-RT service-alerts. Une ligne à l'apparition de l'alerte, puis à
chaque changement de son contenu.

| clé | sens |
|---|---|
| `rt` | horodatage du relevé |
| `alert_id` | identifiant de l'alerte |
| `cause`, `effect` | codes GTFS-RT (`Alert.Cause` / `Alert.Effect`) |
| `header`, `description` | textes (traduction `fr`) |
| `active` | périodes d'activité `[{start, end}]` (ISO 8601 UTC, bornes `null` possibles) |
| `informed` | entités concernées `[{route, stop, dir, trip}]` |

## Analyser après coup

Compresser la journée terminée (DuckDB et pandas lisent le `.gz` directement) :

```bash
gzip data/2026-09-09/*.ndjson
```

### DuckDB

```sql
-- vitesse moyenne par ligne et par heure
SELECT route,
       date_trunc('hour', ft::timestamp) AS h,
       round(avg(spd) * 3.6, 1)          AS kmh_moyen,
       count(*)                          AS points
FROM 'data/2026-09-09/vehicles-2026-09-09.ndjson.gz'
WHERE spd IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2;

-- temps d'arrêt : durées passées en statut "à l'arrêt" (st = 1)
SELECT id, stop, min(ft) AS arrivee, max(ft) AS depart,
       age(max(ft::timestamp), min(ft::timestamp)) AS duree
FROM 'data/2026-09-09/vehicles-2026-09-09.ndjson.gz'
WHERE st = 1
GROUP BY id, stop
HAVING duree > INTERVAL '20 seconds'
ORDER BY duree DESC;
```

### pandas

```python
import pandas as pd
df = pd.read_json("data/2026-09-09/vehicles-2026-09-09.ndjson.gz", lines=True)
df["ft"] = pd.to_datetime(df["ft"])
df["kmh"] = df["spd"] * 3.6

# trajectoire d'un véhicule
one = df[df.id == "ineo-bus:1064"].sort_values("ft")

# croiser avec les horaires théoriques : télécharger le GTFS statique TBM sur
# transport.data.gouv.fr et joindre sur trip / stop pour l'écart à l'horaire.
```

Sources de référence pour l'analyse :

- **GTFS statique** : `https://bdx.mecatran.com/utw/ws/gtfsfeed/static/bordeaux?apiKey=opendata-bordeaux-metropole-flux-gtfs-rt`
  (`bordeaux.gtfs.zip` : `stops`, `routes`, `trips`, `stop_times`, `shapes`,
  `calendar` / `calendar_dates`).
- **Trip-updates GTFS-RT** : `.../gtfsfeed/realtime/bordeaux?apiKey=...` —
  capturé par `--trips`, donne le retard observé sans avoir à le reconstruire.
- **Jours fériés** : `https://calendrier.api.gouv.fr/jours-feries/metropole/<annee>.json`
- **Vacances scolaires** (Bordeaux = Zone A) :
  `https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records?where=location%3D%22Bordeaux%22`
