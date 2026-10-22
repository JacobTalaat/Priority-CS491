import { beforeEach } from "vitest";
import { setDnsResolverForTests } from "@/lib/public-host";

// The suite must never touch real DNS. Before every test, every hostname resolves to a
// public address; a test that needs a private answer installs its own resolver, and the
// next test starts from this default again rather than from the system resolver.
beforeEach(() => {
  setDnsResolverForTests(async () => [{ address: "93.184.216.34" }]);
});
