const ConnectDB = require('../util/connectDB');
const getResponse = require('../util/getResponse');
const { categoryMap } = require('../util/category');
const queryTags = require('../util/queryTags');
const queryTorrents = require('../util/queryTorrents');
const { getGalleryCount } = require('../util/getStats');

const list = async (req, res) => {
	let { category = '', page = 1, limit = 10 } = Object.assign({}, req.params, req.query);
	[page, limit] = [page, limit].map(e => {
		if (e <= 0) {
			return 1;
		}
		return parseInt(e, 10);
	});
	if (limit > 25) {
		return res.json(getResponse(null, 400, 'limit is too large'));
	}

	let cat = [];
	if (!Number.isNaN(+category)) {
		if (category < 0) {
			category = -category ^ 2047;
		}
		Object.entries(categoryMap).forEach(([key, value]) => {
			if (+key & +category) {
				cat.push(value);
			}
		});
	}
	else {
		cat = category.split(/\s*,\s*/).filter(e => e);
	}
	if (!cat.length) {
		return res.json(getResponse(null, 400, 'category is not defined'));
	}

	const conn = await new ConnectDB().connect();

	const indexHint = cat.length === 1 ? 'USE INDEX(idx_category_expunged_posted)' : 'USE INDEX(idx_expunged_posted)';
	const result = await conn.query(
		`SELECT * FROM gallery ${indexHint} WHERE expunged = 0 AND category IN (?)
			ORDER BY posted DESC LIMIT ? OFFSET ?`,
		[cat, limit, (page - 1) * limit]
	);
	let total;
	if (cat.length === 1) {
		total = await getGalleryCount(conn, { expunged: 0, category: cat[0] });
	} else {
		const { total: count } = (await conn.query(
			'SELECT COUNT(*) AS total FROM gallery WHERE expunged = 0 AND category IN (?)',
			[cat]
		))[0];
		total = count;
	}

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

module.exports = list;