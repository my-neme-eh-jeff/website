type Cf = {
  country?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  latitude?: string;
  longitude?: string;
  timezone?: string;
  asn?: number;
  asOrganization?: string;
};

/** Characters a fact keeps: a user agent runs to a few hundred. */
const MAX = 512;

/**
 * What the desk's log gets about a visitor, as x-visitor-* headers. Values are
 * percent-encoded: a city like São Paulo isn't a valid header byte string.
 * verify checks desk/chat-log-proxy.mjs reads the same names.
 */
export function visitorHeaders(request: Request): Record<string, string> {
  const cf = (request as { cf?: Cf }).cf ?? {};
  const h = request.headers;
  const facts: Record<string, string | number | null | undefined> = {
    country: cf.country,
    ip: h.get("cf-connecting-ip"),
    "user-agent": h.get("user-agent"),
    language: h.get("accept-language"),
    page: h.get("referer"),
    city: cf.city,
    region: cf.region,
    postal: cf.postalCode,
    latitude: cf.latitude,
    longitude: cf.longitude,
    timezone: cf.timezone,
    asn: cf.asn,
    network: cf.asOrganization,
  };
  return Object.fromEntries(
    Object.entries(facts)
      .filter(([, v]) => v != null && v !== "")
      // By code point, so a cut can't leave half a surrogate pair.
      .map(([k, v]) => [
        `x-visitor-${k}`,
        encodeURIComponent(Array.from(String(v)).slice(0, MAX).join("")),
      ]),
  );
}
