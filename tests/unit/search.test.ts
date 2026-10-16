import { describe, expect, it } from "vitest";
import { groupSearchResults, mapSearchRows, searchHref, searchStatusEntity } from "@/domain/search/service";

describe("searchHref", () => {
  it("maps every entity type to its detail page", () => {
    expect(searchHref("customer", "c1")).toBe("/app/sales/customers/c1");
    expect(searchHref("contact", "c1")).toBe("/app/sales/customers/c1?tab=contacts");
    expect(searchHref("lead", "l1")).toBe("/app/sales/leads/l1");
    expect(searchHref("quote", "q1")).toBe("/app/sales/quotes/q1");
    expect(searchHref("job", "j1")).toBe("/app/work/jobs/j1");
    expect(searchHref("invoice", "i1")).toBe("/app/money/invoices/i1");
  });

  it("only lifecycle entities get a status vocabulary", () => {
    expect(searchStatusEntity("customer")).toBeNull();
    expect(searchStatusEntity("contact")).toBeNull();
    expect(searchStatusEntity("quote")).toBe("quote");
    expect(searchStatusEntity("invoice")).toBe("invoice");
  });
});

describe("mapSearchRows / groupSearchResults", () => {
  const rows = [
    { entity_type: "invoice", id: "i1", title: "INV-0002", subtitle: "Acme", status: "issued", rank: 1 },
    { entity_type: "customer", id: "c1", title: "Acme", subtitle: "a@acme.co.za", status: "active", rank: 0.4 },
    { entity_type: "contact", id: "c1", title: "Thandi Acme", subtitle: "Acme", status: null, rank: 0.3 },
    { entity_type: "customer", id: "c2", title: "Acme Two", subtitle: "", status: "active", rank: 0.9 },
    { entity_type: "mystery", id: "x", title: "?", subtitle: null, status: null, rank: 1 },
  ];

  it("maps rows, drops unknown types, keeps unique keys for contacts sharing a customer id", () => {
    const r = mapSearchRows(rows);
    expect(r).toHaveLength(4);
    const contact = r.find((x) => x.entityType === "contact")!;
    expect(contact.href).toBe("/app/sales/customers/c1?tab=contacts");
    expect(new Set(r.map((x) => x.key)).size).toBe(4);
    expect(r.find((x) => x.id === "c2")!.subtitle).toBeNull();
  });

  it("groups in a fixed order with rank desc inside a group", () => {
    const g = groupSearchResults(mapSearchRows(rows));
    expect(g.map((x) => x.label)).toEqual(["Customers", "Contacts", "Invoices"]);
    expect(g[0]!.items.map((x) => x.id)).toEqual(["c2", "c1"]);
  });
});
