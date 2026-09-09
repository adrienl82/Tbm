# Add-on Home Assistant : TBM Feed Recorder

Fait tourner [`tools/record-feed.mjs`](../record-feed.mjs) en permanence sur un
Home Assistant OS (Raspberry Pi), avec démarrage au boot, redémarrage
automatique (watchdog) et logs dans l'interface HA. L'archive est écrite dans
`/share/tbm/session-*/` (un dossier par session de service) — récupérable
depuis un PC via l'add-on Samba.

## Installation (add-on local)

1. **Copier le dossier de l'add-on dans HA.** Il doit se retrouver sous
   `/addons/tbm-recorder/` sur le Pi. Au choix :
   - add-on **Samba share** activé → depuis le PC, ouvrir
     `\\homeassistant\addons\`, y créer `tbm-recorder\` et y copier tout le
     contenu de `tools/hass-addon/` (`config.yaml`, `build.yaml`,
     `Dockerfile`, `run.sh`, `icon.png`, `logo.png`) ;
   - ou add-on **Studio Code Server** / **File editor** → créer
     `/addons/tbm-recorder/` et coller les fichiers ;
   - ou en SSH : `git clone` le repo puis
     `cp -r Tbm/tools/hass-addon /addons/tbm-recorder`.

   `icon.png` (icône carrée dans la boutique) et `logo.png` (bandeau en haut
   de la page de l'add-on) sont facultatifs mais font une vraie différence
   visuelle ; ils sont pris en compte après un **Rebuild** de l'add-on.

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
   | `session_cut` | `04:00` | heure locale de coupe quotidienne d'une session |
   | `session_gap_min` | `45` | minutes sans véhicule avant de clôturer une session |
   | `keep_days` | `14` | jours d'archive gardés (`0` = ne jamais purger) |
   | `git_ref` | `claude/mobile-app-rss-tbm-kaob9e` | branche/tag du repo à utiliser |

5. Onglet **Infos** : activer **« Démarrer au démarrage »** et
   **« Watchdog »** (redémarre l'add-on s'il plante), puis **Démarrer**.

6. Onglet **Journal** : vérifier la ligne
   `Demarrage : record-feed --interval 20 --trips --alerts --session-cut 04:00 …`
   puis, toutes les ~10 relevés,
   `poll #N (session …) : X vehicules, +Y lignes, +Z trips`.

## Comment ça tourne

- À chaque démarrage, `run.sh` fait un `git fetch/reset` sur `git_ref` puis
  `npm install` → l'add-on utilise toujours la dernière version du recorder
  sans rebuild. Pour prendre en compte un nouveau commit : **redémarrer**
  l'add-on.
- Le recorder écrit une **session de service** par dossier
  `/share/tbm/session-<ouverture UTC>/` : ouverture au 1ᵉʳ véhicule, fermeture
  à `session_cut` (heure locale) ou après `session_gap_min` minutes sans
  véhicule. À la fermeture il pose un fichier `DONE` (le déclencheur de
  l'analyse à venir) et complète `meta.json`.
- **Arrêter** l'add-on ne ferme *pas* la session en cours : au redémarrage il
  la reprend (via `/share/tbm/state.json`).
- Une fois par heure, `run.sh` **gzippe** les `.ndjson` des sessions closes
  (celles qui ont un `DONE`) et **supprime** les sessions marquées `PROCESSED`
  de plus de `keep_days` jours (garde-fou : purge dure au-delà de
  `2 × keep_days` même sans `PROCESSED`).

## Récupérer et analyser l'archive

Depuis le PC, add-on **Samba share** activé :

```
\\homeassistant\share\tbm\session-20260909T0412\vehicles.ndjson.gz
```

Copier le dossier de session sur le PC et l'analyser avec DuckDB / pandas —
voir [`../README.md`](../README.md) pour les requêtes types (vitesse par
ligne/heure, temps d'arrêt, trajectoires) et les sources de référence
(GTFS statique, jours fériés, vacances scolaires).

## Empreinte sur le Pi

- CPU/RAM : négligeable (1 requête HTTP / 20 s, décodage protobuf, append).
- Carte SD : ~150–300 Mo/session non compressé, ~15–35 Mo/session après gzip
  (positions + trips + alerts). Avec `keep_days: 14` l'archive brute plafonne
  à ~0,5 Go. Pour de longues campagnes, rapatrier les sessions régulièrement
  ou pointer `/share` vers un disque USB.
