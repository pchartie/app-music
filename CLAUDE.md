# App Music — notes pour Claude Code

Lecteur musical local (Node + page web) pour une bibliothèque FLAC/MP3 : Cover Flow en boîtiers CD 3D,
fiches artistes/albums, recherche tolérante, navigation clavier/télécommande.
Voir README.md pour l'usage et l'organisation du code.

## Règles du projet (à respecter absolument)

- **Répondre en français.**
- **Ne jamais toucher aux fichiers audio ni à leur emplacement** : pas de déplacement, renommage, réécriture de tags.
  Les corrections (regroupement d'albums, artistes) se font en mémoire dans `server.js` (`assignAlbums`). Tout le dérivé va dans `cache/`.
- **100 % hors ligne côté interface** : les routes `/api/*` et la page ne lisent que `cache/`. Seul `syncMetadata()`
  contacte Internet (après chaque indexation, réessai toutes les 15 min, `npm run sync`). Aucune ressource externe dans la page.
- Dépôt privé depuis le 2026-11-06 (il a été public et pourra le redevenir) : rien de personnel dans le code (chemins, noms, fichiers du cache).
- Style : sobre, élégant, fluide, « façon Apple », ambiance cinéma sombre. Usage prévu au clavier/télécommande :
  toute nouvelle UI doit être navigable aux flèches (`public/keynav.js`).
- Choix déjà tranchés par l'utilisateur : pas de verso de boîte avec la liste des titres ; Wikipédia limité à la
  première phrase, sans lien externe ; pas de halo qui suit le curseur sur le lecteur ; l'app s'ouvre dans le navigateur
  par défaut (pas de fenêtre « app » dédiée).
- Tester avant de livrer : **`npm test` doit passer** (serveur, recherche, interface dans Brave/Chrome sans fenêtre,
  sur une bibliothèque factice générée dans `tests/fixtures.js`). Toute nouvelle fonction ou correction ajoute son test.
  Essais manuels sur instance isolée : `PORT`, `MUSIC_DIR`, `APPMUSIC_CONFIG`, `APPMUSIC_CACHE`, `APPMUSIC_OFFLINE=1`.
  Puis commit + push sur `main`.

## Sur une nouvelle machine

```sh
git clone https://github.com/pchartie/app-music ~/AppMusic && cd ~/AppMusic
npm install && npm run app        # l'écran d'accueil demande le dossier de musique
```

`cache/` et `config.json` ne sont pas versionnés : les métadonnées se retéléchargent au premier lancement (connexion requise une fois).

**Multiplateforme** : l'app tournera aussi sur un portable Linux (changement de machine prévu). Toute fonction qui
dépend du système (`caffeinate`, `open`, `sips`, `osascript`, détection du réseau…) doit passer par une petite couche
avec un équivalent Linux (`systemd-inhibit`, `xdg-open`…).

## Feuille de route

1. **Téléphone dans l'appartement** (télécommande faite le 2026-11-07 : `lib/remote.js`, `public/m/`, tests `remote*.test.js` ; reste le son sur le téléphone et le HTTPS) : serveur accessible sur le réseau local (aujourd'hui lié à 127.0.0.1 exprès),
   protégé par un code d'accès ; l'écran de choix du dossier reste réservé à la machine locale. Interface tactile/responsive,
   installable comme PWA. Deux modes : son sur le téléphone (streaming) ou télécommande du Mac (le navigateur du Mac joue,
   le téléphone pilote via le serveur, ex. SSE).
2. **Portabilité Linux/Docker** (en vue d'un NAS) : remplacer `sips` (miniatures) et `osascript` (sélecteur Finder),
   fournir une image Docker.
3. **NAS, écoute hors de la maison** : accès via Tailscale (pas d'exposition Internet), transcodage à la volée
   en AAC/Opus pour la 4G (sans toucher aux FLAC).

Étape 1, choix tranchés le 2026-11-07 : **télécommande d'abord** (le Mac joue, le téléphone pilote), un seul utilisateur
(pas de mode invité), accès réseau ouvert seulement sur le réseau de la maison (le portable se déplace ; ailleurs, l'app reste sur
127.0.0.1 : reconnaître le réseau d'une façon qui marche aussi sous Linux), chaque appel du téléphone exige une clé d'appareil obtenue
en scannant un QR code affiché sur le Mac (code à usage unique, quelques minutes), appareils révocables ; actions
d'administration (dossier, réindexation) réservées au Mac ; empêcher la veille pendant le pilotage, jusqu'à 1 h après la dernière action du téléphone ; si l'app n'est pas ouverte,
bouton « Ouvrir sur le Mac » sur le téléphone (le serveur lance la page) ; téléphone Android
(Chrome) ; icône sur l'écran d'accueil = simple raccourci en HTTP (manifeste + bouton « Ajouter à l'écran d'accueil ») ;
la vraie installation (PWA plein écran) attendra le HTTPS, via Tailscale de préférence. Veille : capot fermé = veille quoi qu'il arrive. Phases : socle réseau + clés → appairage QR → interface mobile → télécommande → (plus tard) son sur le téléphone, HTTPS.
