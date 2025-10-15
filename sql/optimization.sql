-- Convert tables to InnoDB engine for better performance and transaction support
ALTER TABLE `gallery` ENGINE = InnoDB;

ALTER TABLE `gid_tid` ENGINE = InnoDB;

ALTER TABLE `tag` ENGINE = InnoDB;

ALTER TABLE `torrent` ENGINE = InnoDB;

-- Rename indexes to follow naming convention (idx_*)
ALTER TABLE `gallery` RENAME INDEX `gid_posted_category_misc` TO `idx_gid_posted_category_misc`;

ALTER TABLE `gallery` RENAME INDEX `posted` TO `idx_posted`;

ALTER TABLE `gallery` RENAME INDEX `category` TO `idx_category`;

ALTER TABLE `gallery` RENAME INDEX `uploader` TO `idx_uploader`;

ALTER TABLE `gallery` RENAME INDEX `expunged` TO `idx_expunged`;

ALTER TABLE `gallery` RENAME INDEX `removed` TO `idx_removed`;

ALTER TABLE `gallery` RENAME INDEX `replaced` TO `idx_replaced`;

ALTER TABLE `gallery` RENAME INDEX `root_gid` TO `idx_root_gid`;

ALTER TABLE `gallery` RENAME INDEX `filecount` TO `idx_filecount`;

ALTER TABLE `gid_tid` ADD PRIMARY KEY (`gid`, `tid`);

ALTER TABLE `gid_tid` DROP INDEX `gid_2`;

ALTER TABLE `gid_tid` RENAME INDEX `tid` TO `idx_tid_gid`;

ALTER TABLE `tag` RENAME INDEX `name` TO `idx_name_id`;

ALTER TABLE `torrent` RENAME INDEX `gid` TO `idx_gid`;

-- Remove duplicate tags and update references
START TRANSACTION;

CREATE TEMPORARY TABLE tmp_duplicate_tags AS
SELECT
  name,
  MIN(id) AS keep_id
FROM tag
GROUP BY name
HAVING COUNT(*) > 1;

CREATE TEMPORARY TABLE tmp_duplicate_map AS
SELECT
  t.id   AS dup_id,
  tmp.keep_id
FROM tag t
JOIN tmp_duplicate_tags tmp ON t.name = tmp.name
WHERE t.id <> tmp.keep_id;

UPDATE gid_tid gt
JOIN tmp_duplicate_map map ON gt.tid = map.dup_id
SET gt.tid = map.keep_id;

DELETE t
FROM tag t
JOIN tmp_duplicate_map map ON t.id = map.dup_id;

COMMIT;

-- Add composite indexes for common query patterns
ALTER TABLE `gallery` ADD INDEX `idx_expunged_posted` (`expunged`, `posted` DESC);

ALTER TABLE `gallery` ADD INDEX `idx_category_expunged_posted` (`category`, `expunged`, `posted` DESC);

ALTER TABLE `gallery` ADD INDEX `idx_uploader_expunged_posted` (`uploader`, `expunged`, `posted` DESC);

ALTER TABLE `gallery` ADD INDEX `idx_rating` (`rating`);

ALTER TABLE `tag` ADD UNIQUE INDEX `idx_name` (`name`);

-- Create statistics tables for caching aggregated data
CREATE TABLE IF NOT EXISTS `gallery_stats` (
  `stat_key` VARCHAR(100) NOT NULL,
  `stat_value` BIGINT NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`stat_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `gallery_stats` (`stat_key`, `stat_value`)
VALUES ('total_active', 0)
ON DUPLICATE KEY UPDATE `stat_value` = `stat_value`;

INSERT INTO `gallery_stats` (`stat_key`, `stat_value`)
SELECT CONCAT('category_', category), COUNT(*)
FROM gallery
WHERE expunged = 0
GROUP BY category
ON DUPLICATE KEY UPDATE `stat_value` = VALUES(`stat_value`);

CREATE TABLE IF NOT EXISTS `uploader_stats` (
  `uploader` VARCHAR(50) NOT NULL,
  `gallery_count` INT NOT NULL DEFAULT 0,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uploader`),
  KEY `idx_count` (`gallery_count`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `uploader_stats` (`uploader`, `gallery_count`)
SELECT uploader, COUNT(*)
FROM gallery
WHERE expunged = 0 AND uploader IS NOT NULL
GROUP BY uploader
ON DUPLICATE KEY UPDATE `gallery_count` = VALUES(`gallery_count`);

CREATE TABLE IF NOT EXISTS `tag_stats` (
  `tag_name` VARCHAR(200) NOT NULL,
  `gallery_count` INT NOT NULL DEFAULT 0,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`tag_name`),
  KEY `idx_count` (`gallery_count`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `tag_stats` (`tag_name`, `gallery_count`)
SELECT b.name, COUNT(DISTINCT a.gid)
FROM gid_tid a
INNER JOIN tag b ON a.tid = b.id
GROUP BY b.name
ON DUPLICATE KEY UPDATE `gallery_count` = VALUES(`gallery_count`);

-- Create stored procedures to update statistics
DELIMITER $$

CREATE PROCEDURE `update_gallery_stats`()
BEGIN
  INSERT INTO `gallery_stats` (`stat_key`, `stat_value`)
  SELECT 'total_active', COUNT(*) FROM gallery WHERE expunged = 0
  ON DUPLICATE KEY UPDATE `stat_value` = VALUES(`stat_value`);

  INSERT INTO `gallery_stats` (`stat_key`, `stat_value`)
  SELECT CONCAT('category_', category), COUNT(*)
  FROM gallery
  WHERE expunged = 0
  GROUP BY category
  ON DUPLICATE KEY UPDATE `stat_value` = VALUES(`stat_value`);
END$$

CREATE PROCEDURE `update_uploader_stats`()
BEGIN
  INSERT INTO `uploader_stats` (`uploader`, `gallery_count`)
  SELECT uploader, COUNT(*)
  FROM gallery
  WHERE expunged = 0 AND uploader IS NOT NULL
  GROUP BY uploader
  ON DUPLICATE KEY UPDATE `gallery_count` = VALUES(`gallery_count`);
END$$

CREATE PROCEDURE `update_tag_stats`()
BEGIN
  INSERT INTO `tag_stats` (`tag_name`, `gallery_count`)
  SELECT b.name, COUNT(DISTINCT a.gid)
  FROM gid_tid a
  INNER JOIN tag b ON a.tid = b.id
  INNER JOIN gallery g ON a.gid = g.gid
  WHERE g.expunged = 0
  GROUP BY b.name
  ON DUPLICATE KEY UPDATE `gallery_count` = VALUES(`gallery_count`);
END$$

DELIMITER ;

-- Add foreign key constraints
ALTER TABLE `gid_tid`
  ADD CONSTRAINT `fk_gid_tid_gallery` FOREIGN KEY (`gid`) REFERENCES `gallery` (`gid`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_gid_tid_tag` FOREIGN KEY (`tid`) REFERENCES `tag` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
