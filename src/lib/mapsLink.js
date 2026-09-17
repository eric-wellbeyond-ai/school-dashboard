const PLACEHOLDER_LOCATION = /^(tba|tbd|n\/a|na|none|unknown|null|undefined|-|–|—)$/i;

export function mapsPlaceLabel(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function isMappableLocation(value) {
  const text = mapsPlaceLabel(value);
  if (!text) return false;
  return !PLACEHOLDER_LOCATION.test(text.replace(/[.\s]+$/g, ''));
}

export function appleMapsUrl(address) {
  return `https://maps.apple.com/?q=${encodeURIComponent(mapsPlaceLabel(address))}`;
}
