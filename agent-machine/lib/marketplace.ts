/**
 * marketplace — the Linux-first developer-program + app marketplace core. Rides Gitea (sovereign source) + the broker
 * (sovereign publisher identity) + the existing MCP plugin-store. Flatpak is a FIRST-CLASS package kind: we federate
 * Flathub AND host our own sovereign OSTree remote, and GOVERN the sandbox (Flatpak finish-args / portals) via scope-d.
 *
 * Note: Flatpak = OSTree (content-addressed delta storage) + bubblewrap (unprivileged-namespace sandbox) + portals +
 * shared runtimes, distributed via remotes (Flathub). It is app sandboxing — NOT LXC/LXD (those are system containers).
 */
export type PackageKind = "flatpak" | "appimage" | "oci" | "mcp-plugin";
export type Risk = "low" | "elevated" | "high";

export interface FlatpakSpec {
  appId: string;        // reverse-DNS, e.g. ai.socioprophet.Notes
  runtime: string;      // e.g. org.freedesktop.Platform//24.08
  remote: string;       // "flathub" | "socioprophet" (our OSTree remote) | …
  branch?: string;      // default "stable"
  finishArgs: string[]; // sandbox permissions (bubblewrap/portal), e.g. ["--share=network","--filesystem=home"]
}

export interface AppManifest {
  id: string;           // marketplace id (reverse-DNS)
  name: string;
  publisher: string;
  kind: PackageKind;
  localFirst: boolean;  // runs offline / sovereign (the Linux-first bar)
  flatpak?: FlatpakSpec;
  oci?: { image: string };
  appimage?: { url: string; sha256: string };
  mcp?: { entry: string };
  signature?: string;   // publisher signature over the manifest (base64url) — verified against the broker identity
  homepage?: string;
}

// Sandbox permissions that meaningfully widen the blast radius (governed by scope-d at install time).
const HIGH = new Set(["--filesystem=host", "--filesystem=host:rw", "--device=all", "--share=ipc"]);
const ELEVATED_PREFIX = ["--filesystem=", "--device=", "--socket=", "--talk-name="];

/** Classify Flatpak finish-args by risk and surface each notable grant (feeds the scope-d install gate). */
export function assessPermissions(finishArgs: string[]): { risk: Risk; flags: string[] } {
  const flags: string[] = [];
  let high = false, elevated = false;
  for (const a of finishArgs) {
    if (HIGH.has(a) || a.includes("org.freedesktop.Flatpak")) { high = true; flags.push(`HIGH: ${a} (can escape the sandbox / full host access)`); }
    else if (a === "--share=network") { elevated = true; flags.push(`elevated: ${a} (network)`); }
    else if (ELEVATED_PREFIX.some((p) => a.startsWith(p))) { elevated = true; flags.push(`elevated: ${a}`); }
  }
  return { risk: high ? "high" : elevated ? "elevated" : "low", flags };
}

const REVDNS = /^[a-z0-9]+(\.[a-z0-9][a-z0-9-]*)+$/i;

/** Conformance validator for the Linux-first/sovereign marketplace. Errors block listing; warnings are advisories. */
export function validateManifest(m: AppManifest): { ok: boolean; errors: string[]; warnings: string[]; risk: Risk } {
  const errors: string[] = [];
  const warnings: string[] = [];
  let risk: Risk = "low";
  if (!REVDNS.test(m.id)) errors.push("id must be reverse-DNS (e.g. ai.socioprophet.Notes)");
  if (!m.name) errors.push("name required");
  if (!m.publisher) errors.push("publisher required");
  if (!m.signature) warnings.push("unsigned — a publisher signature (verified against the broker identity) is recommended");
  if (!m.localFirst) warnings.push("not local-first — flagged: the marketplace is Linux-first/sovereign by default");

  if (m.kind === "flatpak") {
    const f = m.flatpak;
    if (!f) errors.push("flatpak spec required for kind=flatpak");
    else {
      if (!REVDNS.test(f.appId)) errors.push("flatpak.appId must be reverse-DNS");
      if (!f.runtime) errors.push("flatpak.runtime required (e.g. org.freedesktop.Platform//24.08)");
      if (!f.remote) errors.push("flatpak.remote required (flathub | socioprophet | …)");
      const perm = assessPermissions(f.finishArgs ?? []);
      risk = perm.risk;
      warnings.push(...perm.flags);
    }
  } else if (m.kind === "oci" && !m.oci?.image) errors.push("oci.image required");
  else if (m.kind === "appimage" && (!m.appimage?.url || !m.appimage?.sha256)) errors.push("appimage.url + sha256 required");
  else if (m.kind === "mcp-plugin" && !m.mcp?.entry) errors.push("mcp.entry required");

  return { ok: errors.length === 0, errors, warnings, risk };
}

/** The Flatpak ref string: remote:app-id//branch. */
export function flatpakRef(f: FlatpakSpec): string {
  return `${f.remote}:${f.appId}//${f.branch ?? "stable"}`;
}

/** The user-facing install command per package kind. */
export function installCommand(m: AppManifest): string | null {
  if (m.kind === "flatpak" && m.flatpak) return `flatpak install ${m.flatpak.remote} ${m.flatpak.appId}`;
  if (m.kind === "oci" && m.oci) return `podman pull ${m.oci.image}`;
  if (m.kind === "appimage" && m.appimage) return `curl -L ${m.appimage.url} -o app.AppImage && chmod +x app.AppImage`;
  if (m.kind === "mcp-plugin" && m.mcp) return `noetica plugin add ${m.mcp.entry}`;
  return null;
}

/** Registry search over a catalog (id/name/publisher, optionally by kind). */
export function searchApps(catalog: AppManifest[], q: string, kind?: PackageKind): AppManifest[] {
  const needle = q.trim().toLowerCase();
  return catalog.filter((m) =>
    (!kind || m.kind === kind) &&
    (!needle || `${m.id} ${m.name} ${m.publisher}`.toLowerCase().includes(needle)));
}
