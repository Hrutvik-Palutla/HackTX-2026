#!/usr/bin/env node
// Read-only instance discovery. Never logs credentials or default passwords.
import { readFile } from "node:fs/promises";
const file = process.env.VULTR_API_KEY_FILE ?? ".vultr-private/api-key";
const key =
  process.env.VULTR_API_KEY ??
  process.env.Vultr_API_KEY ??
  (await readFile(file, "utf8")
    .then((v) => v.trim())
    .catch(() => null));
if (!key) {
  process.stderr.write(
    "Set VULTR_API_KEY or put the API key in .vultr-private/api-key (ignored by Git).\n",
  );
  process.exit(1);
}
const id = process.env.VULTR_INSTANCE_ID;
if (id && !/^[a-zA-Z0-9-]+$/.test(id)) {
  process.stderr.write("Invalid instance ID.\n");
  process.exit(1);
}
try {
  let next = id
    ? `https://api.vultr.com/v2/instances/${encodeURIComponent(id)}`
    : "https://api.vultr.com/v2/instances?per_page=100";
  const result = [];
  while (next) {
    const url = new URL(next);
    if (url.origin !== "https://api.vultr.com")
      throw Error("Unexpected API pagination URL");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw Error(
        `Vultr returned HTTP ${response.status}; check API access and IP allowlisting.`,
      );
    const body = await response.json();
    for (const item of body.instances ?? [body.instance]) {
      if (item)
        result.push({
          id: item.id,
          label: item.label,
          main_ip: item.main_ip,
          os: item.os,
          ram: item.ram,
          vcpu_count: item.vcpu_count,
          status: item.status,
          power_status: item.power_status,
        });
    }
    next = id ? null : body.meta?.links?.next;
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} catch (error) {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
}
