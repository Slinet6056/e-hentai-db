-- Since api_dump.sqlite has no archiver_key, which changes every hour, you need to allow it to be NULL in MySQL / MariaDB:
ALTER TABLE `gallery` MODIFY COLUMN `archiver_key` varchar(60) NULL;

-- 1. https://github.com/ccloli/e-hentai-db/issues/43
-- 2. When title_jpn does not exist, it will be NULL in api_dump.sqlite. Convert them to "" or just allow NULL in MySQL / MariaDB:
ALTER TABLE `gallery` CHANGE `title` `title` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL, CHANGE `title_jpn` `title_jpn` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL;
