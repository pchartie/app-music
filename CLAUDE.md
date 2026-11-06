# Discothèque — notes pour Claude Code

Lecteur musical local (Node + page web) pour une bibliothèque FLAC/MP3 : Cover Flow en boîtiers CD 3D,
fiches artistes/albums, recherche tolérante, commande vocale locale, navigation clavier/télécommande.
Voir README.md pour l'usage et l'organisation du code.

## Règles du projet (à respecter absolument)

- **Répondre en français.**
- **Ne jamais toucher aux fichiers audio ni à leur emplacement** : pas de déplacement, renommage, réécriture de tags.
  Les corrections (regroupement d'albums, artistes) se font en mémoire dans `server.js` (`assignAlbums`). Tout le dérivé va dans `cache/`.
- **100 % hors ligne côté interface** : les routes `/api/*` et la page ne lisent que `cache/`. Seul `syncMetadata()`
  contacte Internet (après chaque indexation, réessai toutes les 15 min, `npm run sync`). Aucune ressource externe dans la page.
- Dépôt **public** : rien de personnel dans le code (chemins, noms, fichiers du cache).
- Style : sobre, élégant, fluide, « façon Apple », ambiance cinéma sombre. Usage prévu au clavier/télécommande :
  toute nouvelle UI doit être navigable aux flèches (`public/keynav.js`).
- Choix déjà tranchés par l'utilisateur : pas de verso de boîte avec la liste des titres ; Wikipédia limité à la
  première phrase, sans lien externe ; pas de halo qui suit le curseur sur le lecteur ; l'app s'ouvre dans le navigateur
  par défaut (pas de fenêtre « app » dédiée).
- Tester avant de livrer (instances isolées : `PORT`, `MUSIC_DIR`, `DISCO_CONFIG`, `DISCO_CACHE`, `DISCO_OFFLINE=1`),
  puis commit + push sur `main`.

## Sur une nouvelle machine

```sh
git clone https://github.com/pchartie/discotheque ~/Discotheque && cd ~/Discotheque
npm install && npm run app        # l'écran d'accueil demande le dossier de musique
npm run install-voice             # optionnel : reconnaissance vocale (whisper.cpp dans tools/)
```

`cache/` et `config.json` ne sont pas versionnés : les métadonnées se retéléchargent au premier lancement (connexion requise une fois).

## Feuille de route (discutée, pas commencée)

1. **Téléphone dans l'appartement** : serveur accessible sur le réseau local (aujourd'hui lié à 127.0.0.1 exprès),
   protégé par un code d'accès ; l'écran de choix du dossier reste réservé à la machine locale. Interface tactile/responsive,
   installable comme PWA. Deux modes : son sur le téléphone (streaming) ou télécommande du Mac (le navigateur du Mac joue,
   le téléphone pilote via le serveur, ex. SSE). Micro sur téléphone = HTTPS requis.
2. **Portabilité Linux/Docker** (en vue d'un NAS) : remplacer `sips` (miniatures) et `osascript` (sélecteur Finder),
   fournir une image Docker.
3. **NAS, écoute hors de la maison** : accès via Tailscale (pas d'exposition Internet), transcodage à la volée
   en AAC/Opus pour la 4G (sans toucher aux FLAC).

Prochaine étape attendue : l'étape 1 ; l'utilisateur doit choisir la priorité entre « son sur le téléphone » et « télécommande ».
