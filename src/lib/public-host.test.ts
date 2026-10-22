import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PublicHostError,
  assertPublicHost,
  isInternalHostname,
  isPrivateAddress,
  isPrivateIpv4,
  setDnsResolverForTests,
} from "./public-host";

describe("isPrivateIpv4", () => {
  it.each([
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "100.64.0.1",
    "100.127.255.255",
    "224.0.0.1",
    "239.1.1.1",
    "240.0.0.1",
    "249.99.99.99",
    "255.255.255.255",
  ])("recognises private %s", (ip) => {
    expect(isPrivateIpv4(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "172.15.0.1",
    "172.32.0.1",
    "100.128.0.1",
    "100.63.0.1",
    "169.255.0.1",
    "1.1.1.1",
    "140.82.112.3",
  ])("recognises public %s", (ip) => {
    expect(isPrivateIpv4(ip)).toBe(false);
  });
});

describe("isPrivateAddress", () => {
  it("classifies IPv4 addresses the same as isPrivateIpv4", () => {
    expect(isPrivateAddress("10.0.0.5")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("not an ip")).toBe(false);
  });

  it.each([
    "::",
    "::1",
    "fc00::1",
    "fd12:3456::a",
    "fe80::1",
    "febf::1",
    "ff02::1",
    "ff00::",
  ])("recognises private IPv6 %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:7f00:0001",
    "::ffff:10.0.0.9",
    "::127.0.0.2",
  ])("recognises private embedded IPv4 %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    "::ffff:8.8.8.8",
    "::ffff:5300:6258",
    "::102:304",
  ])("treats embedded public IPv4 form %s as public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("isInternalHostname", () => {
  it("rejects reserved names", () => {
    expect(isInternalHostname("localhost")).toBe(true);
    expect(isInternalHostname("api.localhost")).toBe(true);
    expect(isInternalHostname("service.internal")).toBe(true);
  });

  it("rejects literal private addresses", () => {
    expect(isInternalHostname("10.0.0.5")).toBe(true);
    expect(isInternalHostname("[::1]")).toBe(true);
    expect(isInternalHostname("[::ffff:7f00:1]")).toBe(true);
  });

  it("allows public names", () => {
    expect(isInternalHostname("canvas.example.edu")).toBe(false);
    expect(isInternalHostname("njit.instructure.com")).toBe(false);
    expect(isInternalHostname("172.15.0.1")).toBe(false);
  });
});

describe("assertPublicHost", () => {
  const publicResolver = vi.fn().mockResolvedValue([{ address: "93.184.216.34" }]);

  beforeEach(() => {
    publicResolver.mockClear();
    setDnsResolverForTests(publicResolver);
  });

  afterEach(() => {
    setDnsResolverForTests(null);
  });

  it("accepts a hostname resolving to a public IP", async () => {
    await expect(assertPublicHost("canvas.example.edu")).resolves.toBeUndefined();
    expect(publicResolver).toHaveBeenCalledWith("canvas.example.edu");
  });

  it("rejects a hostname resolving to a private IP", async () => {
    setDnsResolverForTests(vi.fn().mockResolvedValue([{ address: "10.0.0.5" }]));
    await expect(assertPublicHost("student-vanity.example.edu")).rejects.toThrow(
      new PublicHostError("private", "Canvas address is not a public host"),
    );
  });

  it("rejects when any resolved address is private", async () => {
    setDnsResolverForTests(
      vi.fn().mockResolvedValue([
        { address: "93.184.216.34" },
        { address: "192.168.0.7" },
      ]),
    );
    await expect(assertPublicHost("multi.example.edu")).rejects.toThrow(PublicHostError);
  });

  it("reports a DNS failure as a network error", async () => {
    setDnsResolverForTests(vi.fn().mockRejectedValue(new Error("ENOTFOUND")));
    await expect(assertPublicHost("missing.example.edu")).rejects.toThrow(
      new PublicHostError("network", "Could not resolve the Canvas address"),
    );
  });

  it("rejects reserved names and private literals without resolving", async () => {
    for (const host of ["localhost", "api.localhost", "service.internal", "10.0.0.5", "[::1]"]) {
      await expect(assertPublicHost(host), host).rejects.toThrow(PublicHostError);
    }
    expect(publicResolver).not.toHaveBeenCalled();
  });

  it("skips DNS when the host is a public literal IP", async () => {
    await expect(assertPublicHost("172.15.0.1")).resolves.toBeUndefined();
    expect(publicResolver).not.toHaveBeenCalled();
  });
});

describe("isPrivateAddress for non-global and embedded forms", () => {
  it.each([
    "198.18.0.1",
    "198.19.255.255",
    "192.0.0.8",
    "192.0.2.1",
    "198.51.100.7",
    "203.0.113.9",
  ])("refuses the non-global IPv4 address %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    "::ffff:0:a00:1",
    "::ffff:0:7f00:1",
    "64:ff9b::a00:1",
    "64:ff9b:1::a00:1",
    "2002:a00:1::",
    "2002:7f00:1::1",
    "fe80::1%en0",
  ])("refuses %s, which embeds a private IPv4 address or cannot be parsed", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["::ffff:0:808:808", "64:ff9b::808:808", "2002:808:808::", "2606:4700:4700::1111", "8.8.8.8"])(
    "still allows the public address %s",
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});
