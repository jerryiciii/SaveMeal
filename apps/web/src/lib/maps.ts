/** Build a universal Google Maps directions URL (opens Google Maps app on Android/iOS or web on desktop). */
export function googleMapsDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}`;
}

/** Build an Apple Maps directions URL (opens Apple Maps directly on iOS/macOS). */
export function appleMapsDirectionsUrl(lat: number, lng: number, label?: string): string {
  const q = label ? `&q=${encodeURIComponent(label)}` : "";
  return `https://maps.apple.com/?daddr=${encodeURIComponent(`${lat},${lng}`)}&dirflg=d${q}`;
}
