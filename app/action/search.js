const ConnectDB = require('../util/connectDB');
const getResponse = require('../util/getResponse');
const matchExec = require('../util/matchExec');
const { categoryMap } = require('../util/category');
const queryTags = require('../util/queryTags');
const queryTorrents = require('../util/queryTorrents');
const normalizedTag = require('../util/normalizedTag');

const search = async (req, res) => {
	let {
		keyword = '', category = '', expunged = 0, minpage = 0, maxpage = 0, minrating = 0,
		mindate = 0, maxdate = 0, removed = 0, replaced = 0, page = 1, limit = 10
	} = Object.assign({}, req.params, req.query);

	[page, limit] = [page, limit].map(e => e <= 0 ? 1 : parseInt(e, 10));
	[
		expunged, minpage, maxpage, minrating, mindate, maxdate
	] = [
		expunged, minpage, maxpage, minrating, mindate, maxdate
	].map(e => parseInt(e, 10));

	if (limit > 25) {
		return res.json(getResponse(null, 400, 'limit is too large'));
	}
	if (minrating > 5) {
		return res.json(getResponse(null, 400, 'min rating is too large'));
	}

	let cats = [];
	if (!Number.isNaN(+category)) {
		if (category < 0) {
			category = -category ^ 2047;
		}
		Object.entries(categoryMap).forEach(([key, value]) => {
			if (+key & +category) {
				cats.push(value);
			}
		});
	}
	else {
		cats = category.split(/\s*,\s*/).filter(e => e);
	}

	const getTargetValue = (input, to, { tag } = {}) => {
		let value = input.trim();
		if (tag) {
			value = value.replace(/"|\$/g, '').replace(/\*$/, '%');
		}

		const exclude = value[0] === '-';
		const or = value[0] === '~';
		if (exclude || or) {
			value = value.substr(1);
		}

		let fullmatch = !tag || /\$"?$/.test(input);
		if (tag) {
			if (!fullmatch && !value.endsWith('%')) {
				value = `${value}%`;
			}
			if (tag && input.startsWith('tag:')) {
				fullmatch = false;
				value = value.replace(/^tag:/, '%:');
			}
			if (value.endsWith('%')) {
				fullmatch = false;
			}
		}

		let target = fullmatch ? to.inc : to.like;
		if (or) {
			target = fullmatch ? to.or : to.orLike;
		}
		if (exclude) {
			value = value.substr(1);
			target = fullmatch ? to.exc : to.notLike;
		}
		return { target, value: normalizedTag(value) };
	};

	keyword = keyword.trim();

	const rawRootIds = matchExec(keyword, /(?:^|\s)(gid:("[\s\S]+?\$?"|.+?\$?))(?=\s|$)/g);
	const rootIds = { inc: [], exc: [] };
	keyword = rawRootIds.reduceRight((pre, cur) => {
		const { target, value } = getTargetValue(cur[1].replace(/"|\$/g, ''), rootIds);
		target.push(+value.split(':', 2)[1]);
		return pre.substr(0, cur.index) + pre.substr(cur.index + cur[0].length);
	}, keyword).trim();

	const rawUploader = matchExec(keyword, /(?:^|\s)(uploader:("[\s\S]+?\$?"|.+?\$?))(?=\s|$)/g);
	const uploader = { inc: [], exc: [], like: [], notLike: [], or: [], orLike: [] };
	keyword = rawUploader.reduceRight((pre, cur) => {
		const { target, value } = getTargetValue(cur[1], uploader, {
			tag: true
		});
		target.push(value.split(':', 2)[1]);
		return pre.substr(0, cur.index) + pre.substr(cur.index + cur[0].length);
	}, keyword).trim();

	const rawTags = matchExec(keyword, /(?:^|\s+)(\S*?:(?:"[\s\S]+?\$?"|[^"]+?\$?))(?=\s|$)/g);
	const tags = { inc: [], exc: [], like: [], notLike: [], or: [], orLike: [] };
	keyword = rawTags.reduceRight((pre, cur) => {
		const { target, value } = getTargetValue(cur[1], tags, {
			tag: true
		});
		target.push(value);
		return pre.substr(0, cur.index) + pre.substr(cur.index + cur[0].length);
	}, keyword).trim();
	tags.inc = [...tags.inc, ...tags.or];
	tags.like = [...tags.like, ...tags.orLike];

	const keywords = { inc: [], exc: [], like: [], notLike: [] };
	(keyword.match(/".+?"|[^\s]+/g) || []).forEach((e) => {
		const { target, value } = getTargetValue(e, keywords);
		target.push(value.replace(/^"|"$/g, ''));
	});

	const conn = await new ConnectDB().connect();

	const whereClauses = [];

	if (!expunged) {
		whereClauses.push('gallery.expunged = 0');
	}
	if (!removed) {
		whereClauses.push('gallery.removed = 0');
	}
	if (!replaced) {
		whereClauses.push('gallery.replaced = 0');
	}

	if (cats.length && cats.length !== 10) {
		whereClauses.push(conn.connection.format('gallery.category IN (?)', [cats]));
	}

	if (rootIds.inc.length) {
		whereClauses.push(conn.connection.format(
			'gallery.root_gid IN (SELECT root_gid FROM gallery WHERE gid IN (?))',
			[rootIds.inc]
		));
	}
	if (rootIds.exc.length) {
		whereClauses.push(conn.connection.format(
			'gallery.root_gid NOT IN (SELECT root_gid FROM gallery WHERE gid IN (?))',
			[rootIds.exc]
		));
	}

	if (uploader.inc.length) {
		whereClauses.push(conn.connection.format('gallery.uploader IN (?)', [uploader.inc]));
	}
	if (uploader.exc.length) {
		whereClauses.push(conn.connection.format('gallery.uploader NOT IN (?)', [uploader.exc]));
	}
	if (uploader.like.length) {
		whereClauses.push(uploader.like.map(e =>
			conn.connection.format('gallery.uploader LIKE ?', [e])
		).join(' OR '));
	}
	if (uploader.notLike.length) {
		whereClauses.push(uploader.notLike.map(e =>
			conn.connection.format('gallery.uploader NOT LIKE ?', [e])
		).join(' AND '));
	}

	if (minpage) {
		whereClauses.push(conn.connection.format('gallery.filecount >= ?', [minpage]));
	}
	if (maxpage) {
		whereClauses.push(conn.connection.format('gallery.filecount <= ?', [maxpage]));
	}
	if (minrating && minrating > 1) {
		whereClauses.push(conn.connection.format('gallery.rating >= ?', [minrating - 0.5]));
	}
	if (mindate) {
		whereClauses.push(conn.connection.format('gallery.posted >= ?', [mindate]));
	}
	if (maxdate) {
		whereClauses.push(conn.connection.format('gallery.posted <= ?', [maxdate]));
	}

	if (keywords.inc.length || keywords.like.length) {
		const keywordConditions = [
			...keywords.inc.map(e => `%${e}%`),
			...keywords.like,
		].map(e => conn.connection.format('CONCAT_WS(\' \', gallery.title, gallery.title_jpn) LIKE ?', e));
		whereClauses.push(`(${keywordConditions.join(' AND ')})`);
	}
	if (keywords.exc.length || keywords.notLike.length) {
		const keywordConditions = [
			...keywords.exc.map(e => `%${e}%`),
			...keywords.notLike,
		].map(e => conn.connection.format('CONCAT_WS(\' \', gallery.title, gallery.title_jpn) NOT LIKE ?', e));
		whereClauses.push(`(${keywordConditions.join(' AND ')})`);
	}

	if (tags.inc.length) {
		const inc = [...new Set(tags.inc)];
		inc.forEach(tagName => {
			whereClauses.push(conn.connection.format(
				`EXISTS (
					SELECT 1 FROM gid_tid
					INNER JOIN tag ON gid_tid.tid = tag.id
					WHERE gid_tid.gid = gallery.gid AND tag.name = ?
				)`,
				[tagName]
			));
		});
	}

	if (tags.like.length) {
		const like = [...new Set(tags.like)];
		like.forEach(pattern => {
			whereClauses.push(conn.connection.format(
				`EXISTS (
					SELECT 1 FROM gid_tid
					INNER JOIN tag ON gid_tid.tid = tag.id
					WHERE gid_tid.gid = gallery.gid AND tag.name LIKE ?
				)`,
				[pattern]
			));
		});
	}

	if (tags.exc.length) {
		tags.exc.forEach(tagName => {
			whereClauses.push(conn.connection.format(
				`NOT EXISTS (
					SELECT 1 FROM gid_tid
					INNER JOIN tag ON gid_tid.tid = tag.id
					WHERE gid_tid.gid = gallery.gid AND tag.name = ?
				)`,
				[tagName]
			));
		});
	}

	if (tags.notLike.length) {
		tags.notLike.forEach(pattern => {
			whereClauses.push(conn.connection.format(
				`NOT EXISTS (
					SELECT 1 FROM gid_tid
					INNER JOIN tag ON gid_tid.tid = tag.id
					WHERE gid_tid.gid = gallery.gid AND tag.name LIKE ?
				)`,
				[pattern]
			));
		});
	}

	const whereClause = whereClauses.length ? whereClauses.join(' AND ') : '1';

	let indexHint = '';
	if (cats.length === 1 && whereClauses.some(c => c.includes('category'))) {
		indexHint = 'USE INDEX(idx_category_expunged_posted)';
	} else if (whereClauses.some(c => c.includes('uploader')) && uploader.inc.length === 1) {
		indexHint = 'USE INDEX(idx_uploader_expunged_posted)';
	} else if (!expunged) {
		indexHint = 'USE INDEX(idx_expunged_posted)';
	}

	const result = await conn.query(
		`SELECT gallery.* FROM gallery ${indexHint}
		WHERE ${whereClause}
		ORDER BY gallery.posted DESC
		LIMIT ? OFFSET ?`,
		[limit, (page - 1) * limit]
	);

	const { total } = (await conn.query(
		`SELECT COUNT(*) AS total FROM gallery ${indexHint}
		WHERE ${whereClause}`
	))[0];

	if (!result.length) {
		conn.destroy();
		return res.json(getResponse([], 200, 'success', { total }));
	}

	const gids = result.map(e => e.gid);
	const rootGids = result.map(e => e.root_gid).filter(e => e);

	const [gidTags, gidTorrents] = await Promise.all([
		queryTags(conn, gids),
		queryTorrents(conn, rootGids)
	]);

	result.forEach(e => {
		e.tags = gidTags[e.gid] || [];
		e.torrents = gidTorrents[e.root_gid] || [];
	});

	conn.destroy();
	return res.json(getResponse(result, 200, 'success', { total }));
};

module.exports = search;
