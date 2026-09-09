# Add-on Home Assistant : TBM Feed Recorder

Fait tourner [`tools/record-feed.mjs`](../record-feed.mjs) en permanence sur un
Home Assistant OS (Raspberry Pi), avec démarrage au boot, redémarrage
automatique (watchdog) et logs dans l'interface HA. L'archive est écrite dans
`/share/tbm/<date>/` — récupérable depuis un PC via l'add-on Samba.

## Installation (add-on local)

1. **Copier le dossier de l'add-on dans HA.** Il doit se retrouver sous
   `/addons/tbm-recorder/` sur le Pi. Au choix :
   - add-on **Samba share** activé → depuis le PC, ouvrir
     `\\homeassistant\addons\`, y créer `tbm-recorder\` et y copier les 4
     fichiers (`config.yaml`, `build.yaml`, `Dockerfile`, `run.sh`) ;
   - ou add-on **Studio Code Server** / **File editor** → créer
     `/addons/tbm-recorder/` et coller les fichiers ;
   - ou en SSH : `git clone` le repo puis
     `cp -r Tbm/tools/hass-addon /addons/tbm-recorder`.

2. **Paramètres → Modules complémentaires → Boutique**, menu ⋮ en haut à
   droite → **Vérifier les mises à jour**. L'add-on **« TBM Feed Recorder »**
   apparaît dans la section *Local add-ons*.

3. L'ouvrir → **Installer** (le build prend 1–3 min sur un Pi : il télécharge
   l'image de base + Node).

4. Onglet **Configuration** :
   | option | défaut | rôle |
   |---|---|---|
   | `interval` | `20` | secondes entre deux relevés du flux |
   | `trips` | `true` | enregistrer aussi le flux trip-updates (retard par course) |
   | `alerts` | `true` | enregistrer aussi le flux perturbations |
   | `keep_days` | `14` | jours d'archive gardés (`0` = ne jamais purger) |
   | `git_ref` | `claude/mobile-app-rss-tbm-kaob9e` | branche/tag du repo à utiliser |

5. Onglet **Infos** : activer **« Démarrer au démarrage »** et
   **« Watchdog »** (redémarre l'add-on s'il plante), puis **Démarrer**.

6. Onglet **Journal** : vérifier la ligne
   `Demarrage : record-feed --interval 20 --trips --alerts --out /share/tbm`
   puis, toutes les ~10 relevés,
   `poll #N : X vehicules, +Y lignes, +Z trips`.

## Comment ça tourne

- À chaque démarrage, `run.sh` fait un `git fetch/reset` sur `git_ref` puis
  `npm install` → l'add-on utilise toujours la dernière version du recorder
  sans rebuild. Pour prendre en compte un nouveau commit : **redémarrer**
  l'add-on.
- Le recorder interroge le flux positions véhicules toutes les `interval`
  secondes et écrit `/share/tbm/<date>/vehicles-<date>.ndjson` (une ligne par
  nouveau point GPS, dédupliqué). Rotation automatique à minuit.
- Une fois par heure, `run.sh` **gzippe** les `.ndjson` des jours terminés et
  **supprime** les dossiers de plus de `keep_days` jours.
- **Arrêter** l'add-on envoie un SIGTERM au recorder → flush + `meta.json` +
  sortie propre.

## Récupérer et analyser l'archive

Depuis le PC, add-on **Samba share** activé :

```
\\homeassistant\share\tbm\2026-09-09\vehicles-2026-09-09.ndjson.gz
```

Copier le `.gz` du jour sur le PC et l'analyser avec DuckDB / pandas — voir
[`../README.md`](../README.md) pour les requêtes types (vitesse par ligne/heure,
temps d'arrêt, trajectoires) et la note sur le croisement avec le GTFS statique.

## Empreinte sur le Pi

- CPU/RAM : négligeable (1 requête HTTP / 20 s, décodage protobuf, append).
- Carte SD : ~100–300 Mo/jour non compressé, ~10–30 Mo/jour après gzip. Avec
  `keep_days: 14` l'archive plafonne à quelques centaines de Mo. Pour de
  longues campagnes, viser `keep_days` bas et rapatrier les `.gz` régulièrement,
  ou pointer `/share` vers un disque USB.
