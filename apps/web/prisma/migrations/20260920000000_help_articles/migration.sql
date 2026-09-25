CREATE TABLE `HelpArticle` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `workspaceId` INTEGER NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `body` MEDIUMTEXT NOT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
    `version` INTEGER NOT NULL DEFAULT 0,
    `createdById` INTEGER NOT NULL,
    `updatedById` INTEGER NOT NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `HelpArticle_workspaceId_status_updatedAt_id_idx` (`workspaceId`, `status`, `updatedAt`, `id`),
    INDEX `HelpArticle_createdById_idx` (`createdById`),
    INDEX `HelpArticle_updatedById_idx` (`updatedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `HelpArticle` ADD CONSTRAINT `HelpArticle_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `HelpArticle` ADD CONSTRAINT `HelpArticle_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `HelpArticle` ADD CONSTRAINT `HelpArticle_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
