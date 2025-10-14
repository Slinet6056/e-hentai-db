const ConnectDB = require('../util/connectDB');
const getResponse = require('../util/getResponse');
const queryTags = require('../util/queryTags');
const queryTorrents = require('../util/queryTorrents');

const favorite = async (req, res) => {
    let { page = 1, limit = 25, favcat } = Object.assign({}, req.query);
    [page, limit] = [page, limit].map(e => {
        if (e <= 0) {
            return 1;
        }
        return parseInt(e, 10);
    });
    if (limit > 100) {
        return res.json(getResponse(null, 400, 'limit is too large'));
    }

    const conn = await new ConnectDB().connect();

    let query = 'SELECT g.*, f.favcat, f.favtime FROM gallery g INNER JOIN favorite f ON g.gid = f.gid';
    let countQuery = 'SELECT COUNT(*) as total FROM favorite f INNER JOIN gallery g ON f.gid = g.gid';
    const params = [];
    const countParams = [];

    // Filter by favorite category if specified
    if (favcat !== undefined && favcat !== null && favcat !== '') {
        const favcatNum = parseInt(favcat, 10);
        if (favcatNum >= 0 && favcatNum <= 9) {
            query += ' WHERE f.favcat = ?';
            countQuery += ' WHERE f.favcat = ?';
            params.push(favcatNum);
            countParams.push(favcatNum);
        }
    }

    query += ' ORDER BY f.favtime DESC LIMIT ? OFFSET ?';
    params.push(limit, (page - 1) * limit);

    const result = await conn.query(query, params);
    const [{ total }] = await conn.query(countQuery, countParams);

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

module.exports = favorite;
