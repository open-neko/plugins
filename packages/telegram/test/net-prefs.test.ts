import { describe, it, expect, afterEach } from "vitest";
import dns from "node:dns";
import { preferIpv4 } from "../src/net-prefs";

describe("preferIpv4", () => {
  afterEach(() => dns.setDefaultResultOrder("verbatim"));

  it("sets the default DNS result order to ipv4first", () => {
    dns.setDefaultResultOrder("verbatim");
    preferIpv4();
    expect(dns.getDefaultResultOrder()).toBe("ipv4first");
  });
});
