# TBM Temps Reel

Site web affichant les prochains passages de bus et tram du reseau TBM
(Bordeaux Metropole) en temps reel, avec recherche d'arrets et arrets
favoris. Aucun backend, aucune installation : ca s'ouvre dans un navigateur
comme n'importe quel site.

## Source des donnees

Les horaires temps reel sont exposes par Bordeaux Metropole via le web
service public **SIRI-Lite** (JSON), documente sur
[transport.data.gouv.fr](https://transport.data.gouv.fr/datasets/offres-de-services-bus-tram-et-scolaire-au-format-gtfs-netex-gtfs-rt-siri-lite).
Cette API envoie des en-tetes CORS permissifs, donc **le navigateur l'appelle
directement**, sans serveur intermediaire :

- `stoppoints-discovery.json` : liste des ~5200 arrets du reseau
- `lines-discovery.json` : lignes (numero, nom, destinations)
- `stop-monitoring.json?MonitoringRef=<arret>` : prochains passages a un arret,
  rafraichi cote serveur toutes les 30 secondes

Ces services sont accessibles avec une cle publique partagee
(`AccountKey=opendata-bordeaux-metropole-flux-gtfs-rt`), sans inscription.
Toute la logique d'appel vit dans `js/tbmApi.js`.

## Architecture

```
index.html            page unique (3 ecrans : recherche, tableau, favoris)
css/style.css         mise en page mobile-first, theme clair/sombre
js/
  tbmApi.js           client SIRI-Lite (fetch + cache localStorage) - pur, testable
  favorites.js        persistance des arrets favoris dans localStorage - pur, testable
  app.js              cablage DOM / UI (ecrans, rafraichissement, favoris)
tests/                tests unitaires Node (js/tbmApi.js, js/favorites.js)
```

`js/app.js` est le seul fichier qui manipule le DOM ; `tbmApi.js` et
`favorites.js` sont des modules purs (aucune dependance au DOM), donc
testables avec Node directement.

## Lancer le site en local

Aucune installation ni build requis, juste servir les fichiers statiques
(l'ouverture directe en `file://` casse les modules JS) :

```bash
python3 -m http.server 8080
# ou : npx serve
```

Puis ouvrir http://localhost:8080/ dans un navigateur.

## Lancer les tests

```bash
node --test tests/*.test.mjs
```

Ces tests couvrent `js/tbmApi.js` (parsing des reponses SIRI-Lite, cache,
gestion d'erreur) et `js/favorites.js`, avec le reseau et `localStorage`
mockes.

## Mettre le site en ligne

Fichiers 100% statiques, hebergeables n'importe ou. Avec ce depot GitHub,
le plus simple est **GitHub Pages** :

1. Dans les parametres du repo : **Settings > Pages**, deployer depuis la
   branche souhaitee (racine du depot).
2. Ouvrir l'URL fournie par GitHub Pages sur n'importe quel appareil
   (iPhone, ordinateur...).

Fonctionne dans n'importe quel navigateur ; sur iPhone, on peut aussi ajouter
un raccourci a l'ecran d'accueil depuis Safari (Partager > Sur l'ecran
d'accueil) si pratique, mais ce n'est pas necessaire pour utiliser le site.

## Fonctionnalites actuelles

- Recherche d'arret par nom
- Tableau des prochains passages (ligne, destination, heure) pour un arret,
  rafraichi automatiquement toutes les 30 s
- Ajout/retrait d'un arret aux favoris (stocke localement dans le
  navigateur, pas de compte ni de synchronisation entre appareils)

## Pistes d'evolution

- Geolocalisation pour proposer les arrets les plus proches
- Alertes/perturbations via `general-message.json`
- Positions des vehicules en temps reel sur une carte (`vehicles` GTFS-RT)
