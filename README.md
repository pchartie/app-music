# Discothèque

Lecteur musical local (FLAC/MP3…) avec Cover Flow 3D, pochettes et fiches artistes/albums.

- Lancer : double-clic sur `~/Applications/Discothèque.app`, ou `npm start` puis http://localhost:4321
- Dossier lu : `~/Downloads` (variable `MUSIC_DIR` pour en changer). Les fichiers audio ne sont **jamais** modifiés ni déplacés : l'app ne fait que les lire.
- Cache (pochettes redimensionnées, métadonnées, photos) : `cache/` — peut être supprimé sans risque, il se reconstruit.
- Sources en ligne : MusicBrainz → Wikidata → Wikipédia (bios, dates), TheAudioDB (photos), Deezer (label, fans), iTunes (pochette manquante).

Raccourcis : Espace lecture/pause · ← → Cover Flow · Entrée retourner la pochette · ⌘F recherche · ⌘← ⌘→ titre précédent/suivant · Échap fermer.
