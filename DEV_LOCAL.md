# Developper en local avec VSCode + Claude Code

Ce guide sert a mettre en place une copie locale du projet pour previsualiser
les changements et lancer les tests sans avoir a commit/push a chaque essai.
Le depot GitHub reste la source de verite ; ce setup local sert juste a
verifier avant d'envoyer.

## Prerequis

- **Git**
- **Python 3** (pour servir le site) ou Node.js avec `npx serve`
- **Node.js 18+** (pour lancer les tests, `node --test`)
- **VSCode**
- **Claude Code CLI** installe (`npm install -g @anthropic-ai/claude-code` ou
  voir https://code.claude.com/docs si pas deja fait)

## 1. Recuperer le projet

Si ce n'est pas deja fait :

```bash
git clone https://github.com/adrienl82/Tbm.git
cd Tbm
```

Sinon, dans le dossier deja clone :

```bash
cd Tbm
git fetch origin
git checkout claude/mobile-app-rss-tbm-kaob9e
git pull
```

`claude/mobile-app-rss-tbm-kaob9e` est la branche de developpement actuelle
(celle sur laquelle les sessions Claude Code distantes travaillent et
poussent). Adapte le nom si une autre branche est en cours.

## 2. Ouvrir dans VSCode

```bash
code .
```

Ouvre un terminal integre dans VSCode (`` Ctrl+` ``) pour les commandes
suivantes.

## 3. Lancer le site en local

Le site est 100% statique (pas de build, ES modules directement dans le
navigateur), mais l'ouverture directe en `file://` casse les imports JS -- il
faut un serveur local minimal :

```bash
python3 -m http.server 8080
```

Puis ouvrir http://localhost:8080/ dans un navigateur.

Pour arreter le serveur : `Ctrl+C` dans le terminal ou il tourne.

## 4. Lancer les tests

```bash
node --test tests/*.test.mjs
```

Tous les modules `js/*.js` sauf `app.js` (qui manipule le DOM) sont des
fonctions pures testables directement avec Node, sans navigateur ni mock
lourd.

## 5. Travailler avec Claude Code en local

Dans le terminal VSCode, a la racine du projet :

```bash
claude
```

Ca ouvre une session Claude Code locale avec acces direct aux fichiers du
projet. Quelques conseils :

- Demande les changements normalement ("ajoute...", "corrige...", "peux-tu
  changer..."), Claude Code local peut lire/modifier les fichiers directement
  puisqu'il tourne sur ta machine.
- Garde le serveur (`python3 -m http.server 8080`) lance dans un **autre**
  terminal en parallele, et rafraichis simplement le navigateur apres chaque
  changement pour voir le resultat -- pas besoin de redemarrer le serveur
  (les fichiers sont servis directement depuis le disque).
- Demande a Claude de lancer `node --test tests/*.test.mjs` avant de
  committer quoi que ce soit.
- Une fois satisfait du resultat en local, demande explicitement le commit +
  push (`git add ... && git commit ... && git push`) -- Claude Code ne le
  fera pas de lui-meme sans que tu le demandes.

## Workflow recommande

1. Ouvrir le site en local (etape 3) et le garder ouvert dans un onglet.
2. Faire les changements avec Claude Code local (etape 5).
3. Rafraichir le navigateur, verifier visuellement.
4. Lancer les tests.
5. Si tout va bien, commit + push une seule fois (au lieu d'un commit par
   petit ajustement, comme ca arrive facilement avec une session distante ou
   chaque aller-retour declenche un rappel a committer).

## Remarques specifiques a ce projet

- Aucune installation ni build requis (`npm install` n'est pas necessaire
  pour faire tourner le site -- seulement si tu ajoutes un jour un outil qui
  en a besoin).
- Les fonds de carte (Esri Light Gray Canvas), Leaflet et protobufjs sont
  charges depuis des CDN externes dans `index.html` -- une connexion internet
  est necessaire meme en local pour voir la carte et les positions en temps
  reel des vehicules.
- Voir `README.md` pour l'architecture generale du projet (sources de
  donnees TBM, organisation des fichiers `js/`).
