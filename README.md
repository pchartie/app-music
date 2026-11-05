# Discothèque

Lecteur musical local pour une bibliothèque FLAC/MP3, dans l'esprit des applications Apple :
Cover Flow en boîtiers de CD 3D, fiches artistes et albums, recherche tolérante, commande vocale,
navigation complète au clavier ou à la télécommande. **Fonctionne entièrement hors ligne.**

![Node](https://img.shields.io/badge/node-%E2%89%A518-green) ![macOS](https://img.shields.io/badge/macOS-oui-lightgrey)

## Démarrage

```sh
npm install
npm start                       # http://localhost:4321
MUSIC_DIR=~/Musique npm start   # pour lire un autre dossier (par défaut : ~/Downloads)
```

Les fichiers audio ne sont **jamais modifiés ni déplacés** : l'app ne fait que les lire.
Tout ce qui est dérivé (pochettes redimensionnées, fiches, photos, articles) va dans `cache/`,
qui peut être supprimé sans risque.

## Hors ligne

- L'interface ne lit que le cache local et ne contacte jamais Internet.
- Le dossier de musique est surveillé : un album ajouté est indexé ~20 s après la fin de la copie,
  puis ses infos sont rapatriées une seule fois (MusicBrainz → Wikidata → Wikipédia pour les biographies
  complètes, TheAudioDB pour les photos, Deezer pour le label). Sans réseau, nouvel essai toutes les 15 min.
- `npm run sync` : indexe, télécharge ce qui manque, puis s'arrête.

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

Variables utiles pour tester : `PORT`, `MUSIC_DIR`, `DISCO_CACHE`, `DISCO_OFFLINE=1` (simule l'absence de réseau).
La génération des miniatures utilise `sips`, fourni avec macOS.
