/** Proofs for the Linux-first marketplace: Flatpak-first conformance, sandbox-permission risk governance, refs +
 *  install commands, and the local-first/sovereign bar. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateManifest, assessPermissions, flatpakRef, installCommand, searchApps, type AppManifest } from "./marketplace.js";

const goodFlatpak: AppManifest = {
  id: "ai.socioprophet.Notes", name: "Notes", publisher: "SocioProphet", kind: "flatpak", localFirst: true,
  signature: "sig", flatpak: { appId: "ai.socioprophet.Notes", runtime: "org.freedesktop.Platform//24.08", remote: "socioprophet", finishArgs: ["--share=network", "--filesystem=home"] },
};

test("a well-formed local-first Flatpak manifest conforms", () => {
  const r = validateManifest(goodFlatpak);
  assert.equal(r.ok, true, r.errors.join("; "));
  assert.equal(r.errors.length, 0);
});

test("federates Flathub: a flathub ref validates and formats correctly", () => {
  const m: AppManifest = { ...goodFlatpak, id: "org.gnome.gedit", flatpak: { appId: "org.gnome.gedit", runtime: "org.gnome.Platform//46", remote: "flathub", finishArgs: [] } };
  assert.equal(validateManifest(m).ok, true);
  assert.equal(flatpakRef(m.flatpak!), "flathub:org.gnome.gedit//stable");
  assert.equal(installCommand(m), "flatpak install flathub org.gnome.gedit");
});

test("conformance errors: non-reverse-DNS id, missing runtime", () => {
  assert.equal(validateManifest({ ...goodFlatpak, id: "Notes" }).ok, false);
  const noRuntime = validateManifest({ ...goodFlatpak, flatpak: { ...goodFlatpak.flatpak!, runtime: "" } });
  assert.ok(noRuntime.errors.some((e) => e.includes("runtime")));
});

test("PERMISSION GOVERNANCE: --filesystem=host is HIGH risk and flagged (scope-d gate)", () => {
  const p = assessPermissions(["--filesystem=host", "--share=network"]);
  assert.equal(p.risk, "high");
  assert.ok(p.flags.some((f) => f.startsWith("HIGH")));
  const low = assessPermissions(["--socket=wayland"]);
  assert.equal(low.risk, "elevated"); // --socket= is a scoped grant
  assert.equal(assessPermissions([]).risk, "low");
});

test("local-first/sovereign bar: a non-local-first app is warned, not blocked", () => {
  const r = validateManifest({ ...goodFlatpak, localFirst: false });
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.includes("local-first")));
});

test("unsigned is a warning; other kinds map to the right install command", () => {
  assert.ok(validateManifest({ ...goodFlatpak, signature: undefined }).warnings.some((w) => w.includes("unsigned")));
  assert.equal(installCommand({ id: "x.y", name: "Z", publisher: "p", kind: "oci", localFirst: false, oci: { image: "ghcr.io/x/y:1" } }), "podman pull ghcr.io/x/y:1");
});

test("registry search filters by text and kind", () => {
  const cat: AppManifest[] = [goodFlatpak, { id: "x.y.Srv", name: "Srv", publisher: "p", kind: "oci", localFirst: false, oci: { image: "i" } }];
  assert.equal(searchApps(cat, "notes").length, 1);
  assert.equal(searchApps(cat, "", "oci").length, 1);
});
