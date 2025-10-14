CREATE TABLE IF NOT EXISTS `favorite` (
  `gid` int(11) NOT NULL,
  `favcat` tinyint(1) NOT NULL,
  `favtime` int(11) NOT NULL,
  PRIMARY KEY (`gid`),
  KEY `idx_favcat_favtime` (`favcat`, `favtime`),
  KEY `idx_favtime` (`favtime`),
  FOREIGN KEY (`gid`) REFERENCES `gallery`(`gid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
