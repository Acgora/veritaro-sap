import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLES, PermissionSet, isRole } from "@/lib/permissions";

const seed = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261014000300_roles_permissions_seed.sql"), "utf8");

describe("permission catalogue", () => {
  it("TS permission keys exactly match the DB seed", () => {
    const block = seed.slice(seed.indexOf("insert into public.permissions"), seed.indexOf("-- Owner: everything."));
    const dbKeys = [...block.matchAll(/\('([a-z_]+\.[a-z_]+)',/g)].map((m) => m[1]).sort();
    expect(dbKeys).toEqual([...PERMISSIONS].sort());
  });

  it("TS roles exactly match the DB seed", () => {
    const block = seed.slice(seed.indexOf("insert into public.roles"), seed.indexOf("insert into public.permissions"));
    const dbRoles = [...block.matchAll(/\('([a-z_]+)',\s+'/g)].map((m) => m[1]).sort();
    expect(dbRoles).toEqual([...ROLES].sort());
  });
});

describe("PermissionSet", () => {
  const set = new PermissionSet(["tasks.create", "tasks.read_all", "not.a_permission"]);
  it("grants listed permissions", () => {
    expect(set.can("tasks.create")).toBe(true);
    expect(set.canAny("tasks.delete", "tasks.read_all")).toBe(true);
  });
  it("denies unlisted permissions and drops unknown keys", () => {
    expect(set.can("tasks.delete")).toBe(false);
    expect(set.toArray()).toEqual(["tasks.create", "tasks.read_all"]);
  });
  it("empty set denies everything", () => {
    expect(PermissionSet.empty().can("organisation.read")).toBe(false);
  });
  it("isRole guards strings", () => {
    expect(isRole("field_agent")).toBe(true);
    expect(isRole("superuser")).toBe(false);
  });
});
