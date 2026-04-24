import { randomUUID } from "node:crypto";
import type { GhostClient, GhostCollection, GhostCollectionRow, ListQuery } from "./client.js";

/**
 * Seed data passed at creation time. Keyed by collection, each value is
 * the initial row list. Tests use this to pre-populate profiles etc.
 */
export type GhostFakeSeed = Partial<{
  [C in GhostCollection]: GhostCollectionRow<C>[];
}>;

interface FakeRow {
  id: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

/**
 * In-memory GhostClient used by unit and integration tests. Behaviour:
 *
 * - Stores one array per collection.
 * - `insert` auto-generates `id`, `created_at`, `updated_at` if absent.
 * - `update` merges patch and bumps `updated_at`.
 * - `upsert` matches existing rows by every key in `on`; if found, patches,
 *   otherwise inserts.
 * - `list` applies filter as equality match, orderBy (multi-key, asc/desc)
 *   on comparable values, and limit.
 *
 * Does not attempt to be a full database, covers the queries the repo
 * layer actually issues.
 */
export function createFakeGhostClient(seed: GhostFakeSeed = {}): GhostClient & {
  all<C extends GhostCollection>(collection: C): GhostCollectionRow<C>[];
  reset(seed?: GhostFakeSeed): void;
} {
  const store = new Map<GhostCollection, FakeRow[]>();

  function load(s: GhostFakeSeed): void {
    store.clear();
    for (const key of Object.keys(s) as GhostCollection[]) {
      const rows = s[key] as unknown as FakeRow[] | undefined;
      if (rows)
        store.set(
          key,
          rows.map((r) => ({ ...r })),
        );
    }
  }

  load(seed);

  function tableOf(collection: GhostCollection): FakeRow[] {
    let t = store.get(collection);
    if (!t) {
      t = [];
      store.set(collection, t);
    }
    return t;
  }

  function matchesFilter(row: FakeRow, filter: Record<string, unknown> | undefined): boolean {
    if (!filter) return true;
    for (const [k, v] of Object.entries(filter)) {
      if (row[k] !== v) return false;
    }
    return true;
  }

  function compare(a: unknown, b: unknown): number {
    if (a === b) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b));
  }

  function sortRows(rows: FakeRow[], orderBy: ListQuery["orderBy"]): FakeRow[] {
    if (!orderBy || orderBy.length === 0) return rows;
    const copy = [...rows];
    copy.sort((l, r) => {
      for (const o of orderBy) {
        const diff = compare(l[o.field], r[o.field]);
        if (diff !== 0) return o.direction === "desc" ? -diff : diff;
      }
      return 0;
    });
    return copy;
  }

  const api: GhostClient & {
    all<C extends GhostCollection>(collection: C): GhostCollectionRow<C>[];
    reset(s?: GhostFakeSeed): void;
  } = {
    async list<C extends GhostCollection>(
      collection: C,
      query?: ListQuery,
    ): Promise<GhostCollectionRow<C>[]> {
      const filtered = tableOf(collection).filter((r) => matchesFilter(r, query?.filter));
      const sorted = sortRows(filtered, query?.orderBy);
      const limited = query?.limit != null ? sorted.slice(0, query.limit) : sorted;
      return limited.map((r) => ({ ...r })) as unknown as GhostCollectionRow<C>[];
    },

    async get<C extends GhostCollection>(
      collection: C,
      id: string,
    ): Promise<GhostCollectionRow<C> | null> {
      const row = tableOf(collection).find((r) => r.id === id);
      return row ? ({ ...row } as unknown as GhostCollectionRow<C>) : null;
    },

    async insert<C extends GhostCollection>(
      collection: C,
      input: Parameters<GhostClient["insert"]>[1],
    ): Promise<GhostCollectionRow<C>> {
      const now = new Date().toISOString();
      const row: FakeRow = {
        ...(input as unknown as FakeRow),
        id: (input as Partial<FakeRow>).id ?? randomUUID(),
        created_at: (input as Partial<FakeRow>).created_at ?? now,
        updated_at: (input as Partial<FakeRow>).updated_at ?? now,
      };
      tableOf(collection).push(row);
      return { ...row } as unknown as GhostCollectionRow<C>;
    },

    async update<C extends GhostCollection>(
      collection: C,
      id: string,
      patch: Partial<GhostCollectionRow<C>>,
    ): Promise<GhostCollectionRow<C>> {
      const table = tableOf(collection);
      const idx = table.findIndex((r) => r.id === id);
      if (idx === -1) {
        throw new Error(`Row ${id} not found in ${collection}`);
      }
      const merged: FakeRow = {
        ...(table[idx] as FakeRow),
        ...(patch as unknown as FakeRow),
        id,
        updated_at: new Date().toISOString(),
      };
      table[idx] = merged;
      return { ...merged } as unknown as GhostCollectionRow<C>;
    },

    async upsert<C extends GhostCollection>(
      collection: C,
      on: Partial<GhostCollectionRow<C>>,
      row: Partial<GhostCollectionRow<C>>,
    ): Promise<GhostCollectionRow<C>> {
      const table = tableOf(collection);
      const onObj = on as Record<string, unknown>;
      const existing = table.find((r) => {
        for (const [k, v] of Object.entries(onObj)) {
          if (r[k] !== v) return false;
        }
        return true;
      });
      if (existing) {
        return api.update(collection, existing.id, {
          ...(row as Partial<GhostCollectionRow<C>>),
          ...(on as Partial<GhostCollectionRow<C>>),
        });
      }
      const merged = { ...(on as object), ...(row as object) } as never;
      return api.insert(collection, merged) as Promise<GhostCollectionRow<C>>;
    },

    all<C extends GhostCollection>(collection: C): GhostCollectionRow<C>[] {
      return tableOf(collection).map((r) => ({ ...r })) as unknown as GhostCollectionRow<C>[];
    },

    reset(s: GhostFakeSeed = {}): void {
      load(s);
    },
  };

  return api;
}
