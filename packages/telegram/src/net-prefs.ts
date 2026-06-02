import dns from "node:dns";

// Plugin microVMs frequently have IPv4-only egress while DNS still returns
// AAAA records, so the default "verbatim" order makes fetch try a dead IPv6
// route first (Happy-Eyeballs eventually falls back, costing ~250ms a call).
// Prefer IPv4 so every Telegram Bot API call connects on the first attempt.
export function preferIpv4(): void {
  dns.setDefaultResultOrder("ipv4first");
}
