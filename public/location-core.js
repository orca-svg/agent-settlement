// Runs only in the browser (also imported by pure unit tests). Coordinates never
// enter the API payload. Distance includes the device's accuracy radius.
export function classifyPosition(position, target) {
  const { latitude: lat, longitude: lon, accuracy } = position.coords;
  const { latitude, longitude, radius = 100 } = target;
  if (![lat, lon, latitude, longitude, accuracy, radius].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(latitude) > 90 || Math.abs(lon) > 180 || Math.abs(longitude) > 180 || accuracy < 0 || radius < 10 || radius > 1000) throw new Error('장소 좌표와 반경을 확인해 주세요');
  const rad = n => n * Math.PI / 180;
  const a = Math.sin(rad(latitude - lat) / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(latitude)) * Math.sin(rad(longitude - lon) / 2) ** 2;
  const distance = 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
  if (accuracy > 200) return 'uncertain';
  if (distance + accuracy <= radius) return 'near';
  if (distance - accuracy > radius) return 'away';
  return 'uncertain';
}
