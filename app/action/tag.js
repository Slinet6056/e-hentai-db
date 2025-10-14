const ConnectDB = require('../util/connectDB');
const getResponse = require('../util/getResponse');
const queryTags = require('../util/queryTags');
const queryTorrents = require('../util/queryTorrents');
const normalizedTag = require('../util/normalizedTag');

const tagList = async (req, res) => {
	let { tag, page = 1, limit = 10 } = Object.assign({}, req.params, req.query);
	[page, limit] = [page, limit].map(e => {
		if (e <= 0) {
			return 1;
		}
		return parseInt(e, 10);
	});
	if (limit > 25) {
		return res.json(getResponse(null, 400, 'limit is too large'));
	}

	const tags = tag.split(/\s*,\s*/).filter(e => e).map(normalizedTag);
	if (!tags.length) {
		return res.json(getResponse(null, 400, 'tag is not defined'));
	}

	const conn = await new ConnectDB().connect();

	let existsClauses = '';
	const queryParams = [];

	if (tags.length === 1) {
		existsClauses = `INNER JOIN gid_tid AS gt ON a.gid = gt.gid
			INNER JOIN tag AS t ON gt.tid = t.id AND t.name = ?`;
		queryParams.push(tags[0]);
	} else {
		existsClauses = tags.map((_, idx) => {
			queryParams.push(tags[idx]);
			return `EXISTS (
				SELECT 1 FROM gid_tid AS gt${idx}
				INNER JOIN tag AS t${idx} ON gt${idx}.tid = t${idx}.id
				WHERE gt${idx}.gid = a.gid AND t${idx}.name = ?
			)`;
		}).join(' AND ');
		existsClauses = `WHERE expunged = 0 AND ${existsClauses}`;
	}

	const result = await conn.query(
		tags.length === 1
			? `SELECT DISTINCT a.* FROM gallery AS a USE INDEX(idx_expunged_posted) ${existsClauses}
				WHERE a.expunged = 0 ORDER BY a.posted DESC LIMIT ? OFFSET ?`
			: `SELECT a.* FROM gallery AS a USE INDEX(idx_expunged_posted) ${existsClauses}
				ORDER BY a.posted DESC LIMIT ? OFFSET ?`,
		[...queryParams, limit, (page - 1) * limit]
	);
	const { total } = (await conn.query(
		tags.length === 1
			? `SELECT COUNT(DISTINCT a.gid) AS total FROM gallery AS a
				INNER JOIN gid_tid AS gt ON a.gid = gt.gid
				INNER JOIN tag AS t ON gt.tid = t.id AND t.name = ?
				WHERE a.expunged = 0`
			: `SELECT COUNT(*) AS total FROM gallery AS a
				WHERE expunged = 0 AND ${tags.map((_, idx) => {
					return `EXISTS (
						SELECT 1 FROM gid_tid AS gt${idx}
						INNER JOIN tag AS t${idx} ON gt${idx}.tid = t${idx}.id
						WHERE gt${idx}.gid = a.gid AND t${idx}.name = ?
					)`;
				}).join(' AND ')}`,
		queryParams
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

module.exports = tagList;