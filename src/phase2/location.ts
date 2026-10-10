export type LocationReading = {
  longitude: number;
  latitude: number;
  accuracy: number;
};
export function requestLocation(maxAccuracy: number): Promise<LocationReading> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is unavailable in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (
          !Number.isFinite(position.coords.accuracy) ||
          position.coords.accuracy > maxAccuracy
        ) {
          reject(
            new Error(
              `Location is inaccurate (±${Math.round(position.coords.accuracy)} m). Required accuracy: ${maxAccuracy} m. Move near a window and retry.`,
            ),
          );
          return;
        }
        resolve({
          longitude: position.coords.longitude,
          latitude: position.coords.latitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) =>
        reject(
          new Error(
            error.code === 1
              ? "Location permission was denied. You can enable it in browser settings and retry."
              : error.code === 3
                ? "Location request timed out. Please retry."
                : "Your location is currently unavailable. Please retry.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}
