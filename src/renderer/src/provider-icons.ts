/**
 * `torrent_list.js` rendered the provider's icon in the first cell; the legacy looked up
 * `<provider>.png` from the provider and fell back to the bundled `images/icons` files.
 * Our provider ids are domain-style, so they map onto the bundled file names here.
 */
const PROVIDER_ICONS: Readonly<Record<string, string>> = {
  'thepiratebay.org': 'tpb.png',
  piratebay: 'tpb.png',
  apibay: 'tpb.png',
  'nyaa.si': 'nyaa.png',
  nyaa: 'nyaa.png',
  yts: 'Yts.png',
  eztv: 'Eztv.png',
  rarbg: 'rarbg.png',
  '1337x': 'T1337x.png',
  rutor: 'Rutor.png',
  rutracker: 'Rutracker.png',
  solidtorrents: 'solidtorrents.png',
  torrentgalaxy: 'TorrentGalaxy.png',
  nnmclub: 'NnmClub.png',
}

/** The bundled icon for a provider id, or undefined when none is known. */
export function providerIcon(provider: string): string | undefined {
  const file = PROVIDER_ICONS[provider.toLowerCase()]
  return file === undefined ? undefined : `images/icons/${file}`
}
