# Discothèque

Lecteur musical local (FLAC/MP3…) avec Cover Flow 3D, pochettes et fiches artistes/albums.

- Lancer : double-clic sur `~/Applications/Discothèque.app`, ou `npm start` puis http://localhost:4321
- Dossier lu : `~/Downloads` (variable `MUSIC_DIR` pour en changer). Les fichiers audio ne sont **jamais** modifiés ni déplacés : l'app ne fait que les lire.
- Cache (pochettes redimensionnées, métadonnées, photos) : `cache/` — peut être supprimé sans risque, il se reconstruit.
- **Fonctionne entièrement hors ligne** : l'interface ne lit que le cache local, elle ne contacte jamais Internet.
- **Nouveaux albums** : le dossier de musique est surveillé. Un album ajouté est indexé ~20 s après la fin de la copie, puis ses infos (bio, photos, dates) sont rapatriées une fois pour toutes. Sans réseau, l'app réessaie toutes les 15 min.
- Synchronisation manuelle : `npm run sync` (indexe, télécharge ce qui manque, puis s'arrête).
- Sources utilisées lors de la synchronisation : MusicBrainz → Wikidata → Wikipédia (bios, dates), TheAudioDB (photos), Deezer (label, fans), iTunes (pochette manquante).

Raccourcis : Espace lecture/pause · ← → Cover Flow · Entrée ou clic sur l'album central pour l'ouvrir · ⌘F recherche · ⌘← ⌘→ titre précédent/suivant · Échap fermer.
