#!/usr/bin/env node

/**
 * Statistics Update Script
 * Run this script periodically to keep the statistics cache tables up to date
 *
 * Usage:
 *   node scripts/updateStats.js [--all|--gallery|--uploader|--tag]
 */

const mysql = require('mysql');
const config = require('../config');

const connection = mysql.createConnection({
	host: config.dbHost,
	port: config.dbPort,
	user: config.dbUser,
	password: config.dbPass,
	database: config.dbName,
});

function query(sql, params = []) {
	return new Promise((resolve, reject) => {
		connection.query(sql, params, (error, results) => {
			if (error) {
				reject(error);
				return;
			}
			resolve(results);
		});
	});
}

async function updateGalleryStats() {
	console.log('Updating gallery statistics...');

	// Update total count statistics
	const totalResult = await query(
		'SELECT COUNT(*) AS total FROM gallery WHERE expunged = 0'
	);
	await query(
		'INSERT INTO gallery_stats (stat_key, stat_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE stat_value = VALUES(stat_value)',
		['total_active', totalResult[0].total]
	);
	console.log(`  - Total active galleries: ${totalResult[0].total}`);

	// Update category statistics
	const categoryResults = await query(
		'SELECT category, COUNT(*) AS count FROM gallery WHERE expunged = 0 GROUP BY category'
	);

	for (const row of categoryResults) {
		await query(
			'INSERT INTO gallery_stats (stat_key, stat_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE stat_value = VALUES(stat_value)',
			[`category_${row.category}`, row.count]
		);
		console.log(`  - Category ${row.category}: ${row.count}`);
	}

	console.log('Gallery statistics update completed!');
}

async function updateUploaderStats() {
	console.log('Updating uploader statistics...');

	// Clean old data
	await query('TRUNCATE TABLE uploader_stats');

	// Batch insert statistics data
	await query(`
		INSERT INTO uploader_stats (uploader, gallery_count)
		SELECT uploader, COUNT(*) AS count
		FROM gallery
		WHERE expunged = 0 AND uploader IS NOT NULL
		GROUP BY uploader
	`);

	const countResult = await query('SELECT COUNT(*) AS total FROM uploader_stats');
	console.log(`Uploader statistics update completed! Total ${countResult[0].total} uploaders`);
}

async function updateTagStats() {
	console.log('Updating tag statistics...');

	// Clean old data
	await query('TRUNCATE TABLE tag_stats');

	// Batch insert statistics data (only count non-expunged galleries)
	await query(`
		INSERT INTO tag_stats (tag_name, gallery_count)
		SELECT t.name, COUNT(DISTINCT gt.gid) AS count
		FROM tag t
		INNER JOIN gid_tid gt ON t.id = gt.tid
		INNER JOIN gallery g ON gt.gid = g.gid
		WHERE g.expunged = 0
		GROUP BY t.name
	`);

	const countResult = await query('SELECT COUNT(*) AS total FROM tag_stats');
	console.log(`Tag statistics update completed! Total ${countResult[0].total} tags`);
}

async function main() {
	const args = process.argv.slice(2);
	const updateAll = args.length === 0 || args.includes('--all');

	try {
		console.log('=================================');
		console.log('Starting statistics update...');
		console.log('=================================\n');

		if (updateAll || args.includes('--gallery')) {
			await updateGalleryStats();
			console.log('');
		}

		if (updateAll || args.includes('--uploader')) {
			await updateUploaderStats();
			console.log('');
		}

		if (updateAll || args.includes('--tag')) {
			await updateTagStats();
			console.log('');
		}

		console.log('=================================');
		console.log('All statistics updates completed!');
		console.log('=================================');

	} catch (error) {
		console.error('Error occurred while updating statistics:', error);
		process.exit(1);
	} finally {
		connection.end();
	}
}

main();
