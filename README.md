<div align="center">

# App Music

**Votre musique FLAC, belle comme au premier jour.**<br>
Un lecteur local pour macOS, dans l'esprit des apps Apple : Cover Flow en boîtiers CD 3D, fiches d'artistes,
recherche qui comprend « metal allemand des années 80 », et zéro dépendance au cloud.

![Node](https://img.shields.io/badge/node-%E2%89%A518-3c873a) ![macOS](https://img.shields.io/badge/macOS-oui-lightgrey) ![Hors ligne](https://img.shields.io/badge/100%25-hors%20ligne-fa2d48) ![Tests](https://img.shields.io/badge/tests-npm%20test-4c6ef5)

<img src="docs/screenshots/cover-flow.jpg" alt="Cover Flow : les albums en boîtiers CD 3D avec reflets" width="100%">

</div>

## Pourquoi App Music

- **Vos fichiers restent intacts.** L'app lit les FLAC et MP3 là où ils sont : aucun déplacement, aucun renommage, aucune réécriture de tags.
- **Hors ligne, pour de vrai.** Les pochettes, biographies et photos sont téléchargées une seule fois. Ensuite, plus besoin d'Internet.
- **Pensée pour le canapé.** Tout se pilote au clavier ou à la télécommande, jusqu'à la recherche vocale (traitée sur votre Mac).
- **Lossless d'abord.** Le format exact est affiché partout : 16 bits/44,1 kHz, 24 bits/96 kHz.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/album.jpg" alt="Page d'un album"><br><b>Albums</b> : pochette inclinable, disque qui tourne pendant l'écoute, présentation en une phrase, titres très connus marqués ★.</td>
    <td width="50%"><img src="docs/screenshots/artist.jpg" alt="Page d'un artiste"><br><b>Artistes</b> : photo, origine, années d'activité, biographie, titres populaires et discographie.</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/albums-queue.jpg" alt="Grille des albums et file À suivre"><br><b>À suivre</b> : glissez un titre ou un album entier dans la file, réorganisez-la, videz-la.</td>
    <td width="50%"><img src="docs/screenshots/search.jpg" alt="Recherche « années 80 »"><br><b>Recherche</b> : fautes de frappe, sigles (« rhcp »), décennies, années, pays, genres.</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/selections.jpg" alt="Sélections : classiques, récemment ajoutés, playlists"><br><b>Sélections</b> : les classiques ★, les albums récemment ajoutés, des playlists toutes prêtes par style et par décennie.</td>
    <td width="50%"><img src="docs/screenshots/now-playing.jpg" alt="Lecture en plein écran"><br><b>À l'écoute</b> : plein écran, couleurs tirées de la pochette, touches multimédia du clavier.</td>
  </tr>
</table>

<sub>Captures réalisées avec une bibliothèque de démonstration : artistes, albums et pochettes inventés (`npm run screenshots`).</sub>

## Installation

Sur un Mac, ouvrez le **Terminal** (⌘ Espace, « Terminal ») et collez cette ligne :

```sh
curl -fsSL https://raw.githubusercontent.com/pchartie/app-music/main/install.sh | zsh
```

Et c'est tout. Node.js est téléchargé si besoin (sans droits administrateur), puis l'app est installée dans `~/AppMusic`
et s'ouvre dans le navigateur. Ensuite, il suffit de double-cliquer sur le raccourci **App Music** du bureau.
Relancer la même ligne met l'app à jour, en gardant le cache et le dossier de musique.

Au premier lancement, un écran d'accueil demande le dossier qui contient la musique : sélecteur du Finder, chemin à saisir,
ou dossiers détectés automatiquement. Ce dossier reste modifiable depuis la colonne de gauche (ligne « Dossier »).
L'app crée aussi `~/Applications/App Music.app` et un raccourci sur le bureau, une seule fois :
si vous le supprimez, il n'est pas recréé, et `npm run make-app` le refait.

**Comment ça marche.** `server.js` est un petit serveur local (127.0.0.1:4321, invisible depuis le réseau) qui indexe la musique
et sert l'audio, les pochettes et les fiches. L'interface est une page web ouverte dans votre navigateur par défaut.

## Hors ligne

- L'interface ne lit que le cache local et ne contacte jamais Internet.
- Le dossier de musique est surveillé : un album ajouté est indexé environ 20 s après la fin de la copie, puis ses infos sont
  récupérées une seule fois. Les présentations viennent de MusicBrainz, Wikidata et Wikipédia, les photos de TheAudioDB,
  le label et la popularité des titres de Deezer. Sans réseau, un nouvel essai a lieu toutes les 15 minutes.
- `npm run sync` indexe, télécharge ce qui manque, puis s'arrête.
- Tout ce qui est calculé ou téléchargé (miniatures, fiches, photos) va dans `cache/`, que vous pouvez supprimer sans risque.

## Recherche

Quelques mots suffisent, même approximatifs : `metalica`, `rhcp`, `acdc`, `années 80`, `80s`, `86`,
`entre 1975 et 1980`, `metal allemand`, `groupe suédois`, `rap`, `chanson française`, `hard rock 90`.
« joue … » ou « lance … » démarre directement la lecture du meilleur résultat.

Une étoile ★ signale les grands classiques, c'est-à-dire les titres classés au moins 800 000 en popularité sur Deezer
(*Nothing Else Matters*, *Seven Nation Army*, *Mistral gagnant*…). Chaque page d'artiste commence par ses titres populaires.

## Sélections

La page **Sélections** réunit des playlists toutes prêtes, calculées à partir de votre bibliothèque :
- **Les classiques ★** : vos titres très connus, du plus célèbre au moins célèbre ;
- **Récemment ajoutés** : les derniers albums arrivés dans le dossier de musique ;
- **par style** (rock, metal, pop, rap, chanson française, classique…) : un style apparaît dès qu'il compte 2 albums et 20 titres ;
- **par décennie** (années 70, 80, 90…), dans l'ordre chronologique.

Le bouton ▶ d'une carte lance la playlist en aléatoire. Un clic sur la carte ouvre la liste des titres.

## Albums en MP3

Un petit triangle ⚠ discret signale les albums dans un format avec perte (MP3, AAC…), sous la pochette et sur la page de l'album.
Le panneau « Ma bibliothèque » indique leur nombre et ouvre une page qui les rassemble. L'app y tient un journal : la date
à laquelle chaque album a été repéré et, une fois remplacé par du FLAC, la date à laquelle il ne l'est plus.
Le bouton **Télécharger la liste des fichiers** donne un CSV (Numbers, Excel) de tous les fichiers concernés, avec leur emplacement.

## Commande vocale (locale)

La reconnaissance vocale utilise [whisper.cpp](https://github.com/ggml-org/whisper.cpp) et tourne entièrement sur votre Mac : votre voix n'est envoyée nulle part.

```sh
npm run install-voice   # compile whisper.cpp et télécharge le modèle « small » (~190 Mo) dans tools/
```

Ensuite, cliquez sur le micro dans la recherche ou appuyez sur `Ctrl+M`. Les noms des artistes de votre bibliothèque aident la reconnaissance.

## Clavier et télécommande

| Touche | Action |
| --- | --- |
| Flèches | Se déplacer (Cover Flow : album précédent / suivant) |
| Entrée / OK | Ouvrir, lancer la lecture |
| Échap / Retour arrière | Revenir, fermer |
| Espace / ⏯ | Lecture / pause |
| ⏭ ⏮, ⌘→ ⌘← | Titre suivant / précédent |
| Une lettre | Commencer une recherche |
| `Ctrl+M` | Recherche vocale |

Sur le curseur de position ou de volume, ← et → avancent de 10 s ou règlent le volume.

## Développement

```sh
git clone https://github.com/pchartie/app-music ~/AppMusic && cd ~/AppMusic
npm install
npm start          # serveur au premier plan (npm run app : en arrière-plan + navigateur)
npm test           # toute la batterie de tests (~25 s)
```

**Tests.** Les tests tournent sur une bibliothèque factice générée à la volée (vrais FLAC 16/44,1 et 24/96, MP3, pochettes),
sans jamais toucher à votre musique. Ils couvrent :
- le serveur : indexation, regroupements, plages audio, confidentialité des chemins, mode hors ligne ;
- la recherche ;
- l'interface, dans Brave, Chrome ou Chromium sans fenêtre : lecture, file « À suivre », clavier, absence de ressources externes.

Pour imposer un navigateur : `APPMUSIC_BROWSER=/chemin/vers/chrome`. Les captures de cette page se régénèrent avec `npm run screenshots`.

**Organisation du code.**

- `server.js` : indexation, audio, cache, synchronisation des métadonnées, reconnaissance vocale
- `public/app.js` : interface (vues, Cover Flow, lecteur, file d'attente)
- `public/search.js` : moteur de recherche (fautes de frappe, sigles, décennies, genres, pays)
- `public/mixes.js` : sélections (classiques, playlists par style et par décennie)
- `public/keynav.js` : navigation spatiale au clavier et à la télécommande
- `public/voice.js` : capture du micro et détection de fin de phrase
- `public/glass.js` : effet de verre liquide du lecteur (réfraction, dispersion)
- `scripts/` : lanceur, création de l'app, reconnaissance vocale, captures d'écran
- `tests/` : batterie de tests et générateur de bibliothèque factice

Variables utiles :
- `PORT` : port du serveur ;
- `MUSIC_DIR` : dossier de musique, prioritaire sur `config.json` ;
- `APPMUSIC_CONFIG` et `APPMUSIC_CACHE` : emplacements de la config et du cache ;
- `APPMUSIC_OFFLINE=1` : simule l'absence de réseau.

Les miniatures sont générées avec `sips`, fourni avec macOS.
