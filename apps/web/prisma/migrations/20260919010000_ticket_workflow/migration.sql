ALTER TABLE `Ticket`
    ADD COLUMN `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    ADD COLUMN `assigneeId` INTEGER NULL,
    ADD COLUMN `version` INTEGER NOT NULL DEFAULT 0;

CREATE INDEX `Ticket_assigneeId_idx` ON `Ticket`(`assigneeId`);
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_assigneeId_fkey` FOREIGN KEY (`assigneeId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `TicketChange` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ticketId` INTEGER NOT NULL,
    `actorId` INTEGER NOT NULL,
    `version` INTEGER NOT NULL,
    `field` ENUM('STATUS', 'PRIORITY', 'ASSIGNEE') NOT NULL,
    `before` VARCHAR(191) NULL,
    `after` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `TicketChange_ticketId_version_field_key`(`ticketId`, `version`, `field`),
    INDEX `TicketChange_actorId_idx`(`actorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TicketChange` ADD CONSTRAINT `TicketChange_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `Ticket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TicketChange` ADD CONSTRAINT `TicketChange_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
