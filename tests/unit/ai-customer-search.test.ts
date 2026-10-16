import { describe, expect, it, vi } from "vitest";

const listCustomers = vi.fn(async (_ctx: unknown, input: { status: string }) => ({
  ok: true as const,
  data: {
    total: 1, page: 1, pageSize: 10,
    customers: input.status === "active"
      ? [{ id: "a", display_name: "DJ Ossewa", type: "business", email: null, phone: null, status: "active", created_at: "" }]
      : [{ id: "b", display_name: "DJ Ossewa (old)", type: "business", email: null, phone: null, status: "archived", created_at: "" }],
  },
}));
vi.mock("@/domain/customers/service", async (orig) => ({ ...(await orig<object>()), listCustomers }));

const { searchCustomersTool } = await import("@/lib/ai/tools/customers");
const ctx = {} as Parameters<typeof searchCustomersTool.execute>[0];

describe("search_customers (regression: restored customer 'not found')", () => {
  it("includeArchived returns active AND archived customers", async () => {
    const r = await searchCustomersTool.execute(ctx, { query: "DJ Ossewa", includeArchived: true });
    expect(r.ok && (r.data as { customers: { status: string }[] }).customers.map((c) => c.status)).toEqual(["active", "archived"]);
  });
  it("default search returns active only", async () => {
    const r = await searchCustomersTool.execute(ctx, { query: "DJ Ossewa" });
    expect(r.ok && (r.data as { customers: { id: string }[] }).customers.map((c) => c.id)).toEqual(["a"]);
  });
});
