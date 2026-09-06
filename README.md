# TBM Temps Reel

Application web installable (PWA) affichant les prochains passages de bus et
tram du reseau TBM (Bordeaux Metropole) en temps reel, avec recherche
d'arrets et arrets favoris. Concue pour etre developpee entierement sous
Linux/Windows et installee sur iPhone sans Mac ni compte Apple Developer.

## Pourquoi une PWA plutot qu'une app Kivy/native

TBM ne publie pas de veritable flux RSS : les horaires temps reel sont
exposes par Bordeaux Metropole via le web service public **SIRI-Lite**
(JSON), et cette API envoie des en-tetes CORS permissifs, donc **le
navigateur peut l'appeler directement, sans backend**.

Compiler une app native pour iPhone (Kivy, React Native, Flutter...)
necessite Xcode, donc un Mac, plus un compte Apple Developer pour
l'installer sur un appareil physique. Une PWA n'a besoin d'aucun des deux :
- developpement et tests 100% sous Linux/Windows,
- installation sur iPhone via Safari > Partager > "Sur l'ecran d'accueil",
- l'app se comporte comme une app installee (icone, plein ecran, pas de
  barre d'adresse), avec un usage hors-ligne minimal (l'interface se charge
  meme sans reseau, seules les donnees temps reel ont besoin du reseau).

## Source des donnees

Documentation : [transport.data.gouv.fr](https://transport.data.gouv.fr/datasets/offres-de-services-bus-tram-et-scolaire-au-format-gtfs-netex-gtfs-rt-siri-lite)

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
manifest.webmanifest  metadonnees PWA (nom, icones, mode standalone)
service-worker.js     cache l'interface pour un chargement hors-ligne
icons/                icones de l'app (192, 512, apple-touch-icon)
tests/                tests unitaires Node (js/tbmApi.js, js/favorites.js)
```

Aucun backend : tout tourne dans le navigateur. `js/app.js` est le seul
fichier qui manipule le DOM ; `tbmApi.js` et `favorites.js` sont des modules
purs (aucune dependance au DOM), donc testables avec Node directement.

## Lancer l'application en local

Aucune installation ni build requis, juste servir les fichiers statiques
(l'ouverture directe en `file://` casse les modules JS et le service worker) :

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

## Mettre l'app en ligne et l'installer sur l'iPhone

La PWA doit etre servie en HTTPS pour etre installable (le service worker et
l'ajout a l'ecran d'accueil l'exigent). Le plus simple avec ce depot GitHub :

1. Dans les parametres du repo GitHub : **Settings > Pages**, choisir de
   deployer depuis la branche souhaitee (racine du depot).
2. Une fois publie, ouvrir l'URL fournie par GitHub Pages sur l'iPhone, dans
   **Safari** (obligatoire, Chrome iOS ne propose pas l'installation).
3. Bouton **Partager** (carre avec fleche) > **Sur l'ecran d'accueil**.

L'app apparait alors comme une icone normale, en plein ecran, sans URL
visible. Toute mise a jour poussee sur la branche deployee se repercute au
prochain lancement.

## Fonctionnalites actuelles

- Recherche d'arret par nom
- Tableau des prochains passages (ligne, destination, heure) pour un arret,
  rafraichi automatiquement toutes les 30 s
- Ajout/retrait d'un arret aux favoris (stocke localement sur l'appareil,
  pas de compte ni de synchronisation entre appareils)
- Installable sur l'ecran d'accueil iOS, interface utilisable hors-ligne

## Pistes d'evolution

- Geolocalisation pour proposer les arrets les plus proches
- Alertes/perturbations via `general-message.json`
- Notifications quand un passage favori approche (necessiterait un Web
  Push, plus limite sur iOS que sur Android)
