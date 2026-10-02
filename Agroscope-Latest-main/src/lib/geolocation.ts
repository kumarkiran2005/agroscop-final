/**
 * Shared device-location helpers.
 *
 * Both the Live Crop Prices page and the listing input page resolve the user's
 * city the same way, so the logic lives here rather than being duplicated —
 * a price quoted on one screen should never disagree with the other because
 * one of them resolved the city differently.
 */

export const DEFAULT_CITY = 'Chennai';

/** Reverse-geocode coordinates to a city name via OpenStreetMap Nominatim. */
export async function reverseGeocodeToCity(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
      { headers: { Accept: 'application/json', 'Accept-Language': 'en' } },
    );
    const data = await res.json();
    return (
      data?.address?.city ||
      data?.address?.town ||
      data?.address?.village ||
      data?.address?.county ||
      data?.address?.state_district ||
      data?.address?.state ||
      data?.display_name?.split(',')[0]?.trim() ||
      DEFAULT_CITY
    );
  } catch {
    return DEFAULT_CITY;
  }
}

export type LocationStatus = 'idle' | 'getting' | 'done' | 'error';

export interface DeviceCityResult {
  city: string;
  error: string | null;
}

/**
 * Ask the browser for the device position and resolve it to a city name.
 * Always resolves — on denial or failure it returns DEFAULT_CITY plus a message
 * the caller can surface, so the UI never gets stuck in a loading state.
 */
export function getCityFromDevice(): Promise<DeviceCityResult> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ city: DEFAULT_CITY, error: 'Location is not supported on this device.' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const city = await reverseGeocodeToCity(
          position.coords.latitude,
          position.coords.longitude,
        );
        resolve({ city, error: null });
      },
      (err) => {
        resolve({
          city: DEFAULT_CITY,
          error:
            err.code === err.PERMISSION_DENIED
              ? 'Location denied. Using default city.'
              : 'Could not get location. Using default city.',
        });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}
