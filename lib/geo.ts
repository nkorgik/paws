// Privacy offset: move a real coordinate 1–3 km in a random direction so the
// dot is placed *near* the user, never at their exact location. `r1`/`r2` are
// random numbers in [0, 1) that pick the distance and bearing. The join route
// derives them from the session token, so each session gets its own offset
// but re-joining within a session lands on the same spot. (Fresh randomness
// on every re-join would let an observer average many dots back to the real
// location.)

const KM_PER_DEG_LAT = 111.32;

export function applyPrivacyOffset(
  lat: number,
  lng: number,
  r1: number = Math.random(),
  r2: number = Math.random(),
): { lat: number; lng: number } {
  const distanceKm = 1 + r1 * 2; // 1–3 km
  const bearing = r2 * 2 * Math.PI; // random direction

  const dLat = (distanceKm * Math.cos(bearing)) / KM_PER_DEG_LAT;
  const latRad = (lat * Math.PI) / 180;
  const dLng =
    (distanceKm * Math.sin(bearing)) /
    (KM_PER_DEG_LAT * Math.cos(latRad) || KM_PER_DEG_LAT);

  return {
    lat: clamp(lat + dLat, -90, 90),
    lng: wrapLng(lng + dLng),
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function wrapLng(lng: number): number {
  // Keep longitude in [-180, 180].
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

// Great-circle distance in km (haversine).
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Friendly, deliberately coarse distance label. Peers' dots are already
// offset 1–3 km, so anything close is just "nearby".
export function describeDistance(km: number): string {
  if (km < 5) return "nearby";
  if (km < 100) return `~${Math.round(km / 5) * 5} km away`;
  if (km < 1000) return `~${Math.round(km / 50) * 50} km away`;
  return `~${(Math.round(km / 500) * 500).toLocaleString("en-US")} km away`;
}
