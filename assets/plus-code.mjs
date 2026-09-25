// Adapted from Google Open Location Code's integer-based Python implementation.
// Copyright Google Inc. Apache-2.0; see vendor/OPEN-LOCATION-CODE-LICENSE.
// Source revision: 83986da0156bbf51fba33d0327d8ca4b7f955c89
// https://github.com/google/open-location-code/blob/83986da0156bbf51fba33d0327d8ca4b7f955c89/python/openlocationcode/openlocationcode.py
// The upstream JS floating-point encoder disagrees with current boundary vectors.
// This implementation is tested against the upstream encoding.csv, unmodified.
const alphabet = "23456789CFGHJMPQRVWX";
const latitudePrecision = 8000 * 5 ** 5,
  longitudePrecision = 8000 * 4 ** 5;
// Scale the coordinate's decimal representation exactly. Floating-point multiplication
// can otherwise put an exact grid boundary (e.g. longitude 129.7) in the previous cell.
function floorScaled(value, scale) {
  const [mantissa, exponent = "0"] = String(value).toLowerCase().split("e");
  const negative = mantissa.startsWith("-");
  const [whole, fraction = ""] = mantissa.replace(/^[+-]/, "").split(".");
  let numerator =
    BigInt((whole || "0") + fraction) * BigInt(scale) * (negative ? -1n : 1n);
  const power = fraction.length - Number(exponent);
  if (power <= 0) return Number(numerator * 10n ** BigInt(-power));
  const denominator = 10n ** BigInt(power);
  return Number(
    numerator / denominator -
      (numerator < 0n && numerator % denominator !== 0n ? 1n : 0n),
  );
}
export function encodePlusCode(latitude, longitude, length = 10) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
    throw new Error("经纬度必须是有限数字");
  if (
    !Number.isInteger(length) ||
    length < 2 ||
    (length < 10 && length % 2 !== 0)
  )
    throw new Error("地点码长度无效");
  length = Math.min(length, 15);
  let lat =
    floorScaled(Math.max(-90, Math.min(90, latitude)), latitudePrecision) +
    90 * latitudePrecision;
  lat = Math.min(180 * latitudePrecision - 1, Math.max(0, lat));
  const lngRange = 360 * longitudePrecision;
  let lng =
    floorScaled(longitude, longitudePrecision) + 180 * longitudePrecision;
  lng = ((lng % lngRange) + lngRange) % lngRange;
  let code = "";
  if (length > 10) {
    for (let i = 0; i < 5; i++) {
      code = alphabet[(lat % 5) * 4 + (lng % 4)] + code;
      lat = Math.floor(lat / 5);
      lng = Math.floor(lng / 4);
    }
  } else {
    lat = Math.floor(lat / 5 ** 5);
    lng = Math.floor(lng / 4 ** 5);
  }
  for (let i = 0; i < 5; i++) {
    code = alphabet[lat % 20] + alphabet[lng % 20] + code;
    lat = Math.floor(lat / 20);
    lng = Math.floor(lng / 20);
  }
  code = code.slice(0, 8) + "+" + code.slice(8);
  return length >= 8
    ? code.slice(0, length + 1)
    : code.slice(0, length) + "0".repeat(8 - length) + "+";
}
