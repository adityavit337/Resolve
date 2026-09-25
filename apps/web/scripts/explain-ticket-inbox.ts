import assert from "node:assert/strict";
import { getDb } from "../lib/db.ts";
import { isLocalDevelopmentDatabase } from "../lib/tickets.ts";

assert.ok(isLocalDevelopmentDatabase(), "Query-plan inspection requires local resolve_dev");
const db = getDb();
try {
  const workspace = await db.workspace.findFirst({ orderBy: { id: "asc" }, select: { id: true } });
  assert.ok(workspace, "Create a local workspace first");
  const id = workspace.id;
  console.log(JSON.stringify({ workspaceId: id, workspaceTickets: await db.ticket.count({ where: { workspaceId: id } }), totalTickets: await db.ticket.count() }));
  const plans = {
    inbox: await db.$queryRaw`EXPLAIN SELECT id, subject, description, status, priority, assigneeId, createdAt FROM Ticket WHERE workspaceId = ${id} ORDER BY createdAt DESC, id DESC LIMIT 20`,
    status: await db.$queryRaw`EXPLAIN SELECT id, subject, description, status, priority, assigneeId, createdAt FROM Ticket WHERE workspaceId = ${id} AND status = 'OPEN' ORDER BY createdAt DESC, id DESC LIMIT 20`,
    priority: await db.$queryRaw`EXPLAIN SELECT id, subject, description, status, priority, assigneeId, createdAt FROM Ticket WHERE workspaceId = ${id} AND priority = 'HIGH' ORDER BY createdAt DESC, id DESC LIMIT 20`,
    unassigned: await db.$queryRaw`EXPLAIN SELECT id, subject, description, status, priority, assigneeId, createdAt FROM Ticket WHERE workspaceId = ${id} AND assigneeId IS NULL ORDER BY createdAt DESC, id DESC LIMIT 20`,
    search: await db.$queryRaw`EXPLAIN SELECT id, subject, description, status, priority, assigneeId, createdAt FROM Ticket WHERE workspaceId = ${id} AND (subject LIKE ${"%ticket%"} OR description LIKE ${"%ticket%"}) ORDER BY createdAt DESC, id DESC LIMIT 20`,
    count: await db.$queryRaw`EXPLAIN SELECT COUNT(*) FROM Ticket WHERE workspaceId = ${id} AND status = 'OPEN'`,
  };
  console.log(JSON.stringify(plans, (_, value) => typeof value === "bigint" ? Number(value) : value, 2));
} finally { await db.$disconnect(); }
