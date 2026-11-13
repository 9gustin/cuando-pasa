// Sentido de una parada: "centro" o "afuera" (PLAN §6.3).
import { distanciaM } from '../tubondi/normalizar.js';

export const PLAZA_SAN_MARTIN = { lat: -31.4167, lon: -64.1836 };

/**
 * Si la mayoría de los coches que vienen están más lejos del centro que la parada, la vereda es "centro"
 * (los coches vienen de afuera y van hacia el centro). Si no, "afuera". Sin coches: '?'.
 * @param parada {lat, lon}   @param coches [{coche_lat, coche_lon}]
 */
export function calcularSentido(parada, coches) {
  const utiles = coches.filter((c) => Number.isFinite(c.coche_lat) && Number.isFinite(c.coche_lon));
  if (!utiles.length || !Number.isFinite(parada?.lat)) return '?';
  const dP = distanciaM(parada.lat, parada.lon, PLAZA_SAN_MARTIN.lat, PLAZA_SAN_MARTIN.lon);
  const masLejos = utiles.filter((c) => distanciaM(c.coche_lat, c.coche_lon, PLAZA_SAN_MARTIN.lat, PLAZA_SAN_MARTIN.lon) > dP).length;
  return masLejos * 2 > utiles.length ? 'centro' : 'afuera';
}
