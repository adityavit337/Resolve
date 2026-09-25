CREATE INDEX `Ticket_workspaceId_createdAt_id_idx` ON `Ticket`(`workspaceId`, `createdAt`, `id`);
CREATE INDEX `Ticket_workspaceId_status_createdAt_id_idx` ON `Ticket`(`workspaceId`, `status`, `createdAt`, `id`);
