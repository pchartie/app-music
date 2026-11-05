# Discothèque

Lecteur musical local pour une bibliothèque FLAC/MP3, dans l'esprit des applications Apple :
Cover Flow en boîtiers de CD 3D, fiches artistes et albums, recherche tolérante, commande vocale,
navigation complète au clavier ou à la télécommande. **Fonctionne entièrement hors ligne.**

![Node](https://img.shields.io/badge/node-%E2%89%A518-green) ![macOS](https://img.shields.io/badge/macOS-oui-lightgrey)

## Démarrage

Prérequis : macOS et [Node.js](https://nodejs.org) 18 ou plus.

```sh
git clone https://github.com/pchartie/discotheque && cd discotheque
npm install
npm run make-app   # crée ~/Applications/Discothèque.app (à double-cliquer ensuite)
npm run app        # ou lance directement
```

Au premier lancement, un écran d'accueil demande le dossier qui contient la musique (sélecteur du Finder,
chemin à saisir, ou dossiers détectés automatiquement). Il reste modifiable depuis la colonne de gauche
(ligne « Dossier »). Le choix est enregistré dans `config.json`, propre à chaque machine.

**Comment ça tourne** : `server.js` est un petit serveur web local (127.0.0.1:4321, invisible depuis le réseau)
qui indexe la musique et sert l'audio, les pochettes et les fiches ; l'interface est une page web. Le lanceur
démarre le serveur en arrière-plan s'il ne tourne pas, puis ouvre une fenêtre d'application dédiée
(Chrome, Brave ou Edge ; sinon le navigateur par défaut). `npm start` lance le serveur au premier plan.

Les fichiers audio ne sont **jamais modifiés ni déplacés** : l'app ne fait que les lire.
Tout ce qui est dérivé (pochettes redimensionnées, fiches, photos) va dans `cache/`,
qui peut être supprimé sans risque.

## Hors ligne

- L'interface ne lit que le cache local et ne contacte jamais Internet.
- Le dossier de musique est surveillé : un album ajouté est indexé ~20 s après la fin de la copie,
  puis ses infos sont rapatriées une seule fois (MusicBrainz → Wikidata → Wikipédia pour la présentation,
  TheAudioDB pour les photos, Deezer pour le label et la popularité des titres). Sans réseau, nouvel essai toutes les 15 min.
- `npm run sync` : indexe, télécharge ce qui manque, puis s'arrête.

## Titres très connus

Une étoile ★ signale les grands classiques (classement de popularité Deezer ≥ 800 000 : *Nothing Else Matters*,
*Seven Nation Army*, *Mistral gagnant*…). Chaque page d'artiste commence par ses titres populaires.

## Recherche

Quelques mots suffisent, même approximatifs : `metalica`, `rhcp`, `acdc`, `années 80`, `80s`, `86`,
`entre 1975 et 1980`, `metal allemand`, `groupe suédois`, `rap`, `chanson française`, `hard rock 90`.
« joue … » / « lance … » démarre directement la lecture du meilleur résultat.

## Commande vocale (locale)

Reconnaissance par [whisper.cpp](https://github.com/ggml-org/whisper.cpp), sur la machine : la voix ne sort pas.

```sh
npm run install-voice   # compile whisper.cpp et télécharge le modèle « small » (~190 Mo) dans tools/
```

Puis bouton micro dans la recherche, ou `Ctrl+M`. Les noms d'artistes de la bibliothèque guident la reconnaissance.

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

Sur le curseur de position ou de volume : ← → pour avancer de 10 s / régler le volume.

## Organisation du code

- `server.js` : indexation, audio, cache, synchronisation des métadonnées, reconnaissance vocale
- `public/app.js` : interface (vues, Cover Flow, lecteur)
- `public/search.js` : moteur de recherche (fautes de frappe, sigles, décennies, genres, pays)
- `public/keynav.js` : navigation spatiale au clavier / à la télécommande
- `public/voice.js` : capture du micro et détection de fin de phrase
- `public/glass.js` : effet de verre liquide du lecteur (réfraction, dispersion)
- `scripts/` : lanceur, création de l'app, installation de la reconnaissance vocale

Variables utiles pour tester : `PORT`, `MUSIC_DIR` (prioritaire sur `config.json`), `DISCO_CONFIG`, `DISCO_CACHE`, `DISCO_OFFLINE=1` (simule l'absence de réseau).
La génération des miniatures utilise `sips`, fourni avec macOS.
