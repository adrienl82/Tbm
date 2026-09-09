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
| `--raw` | off | garde aussi chaque réponse protobuf brute, gzippée (`raw/HHMMSS.pb.gz`) |
| `--alerts` | off | enregistre en plus le flux perturbations |
| `--once` | off | un seul relevé puis sortie (test rapide) |

Sortie (rotation automatique à minuit, heure locale) :

```
data/2026-09-09/
  vehicles-2026-09-09.ndjson    une ligne par point GPS (voir champs plus bas)
  alerts-2026-09-09.ndjson      --alerts
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

Le flux `trips` (retards théoriques GTFS-RT) n'est **pas** exposé
publiquement par TBM ; l'écart à l'horaire se reconstruit en croisant ces
positions avec le GTFS statique (`stop_times.txt`).
