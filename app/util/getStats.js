/**
 * 从统计缓存表获取计数，避免实时COUNT查询
 */

const getGalleryCount = async (conn, conditions = {}) => {
    const {
        expunged = 0,
        category = null,
        uploader = null,
        customWhere = null,
        params = []
    } = conditions;

    // 如果是简单的全局统计，直接从缓存表读取
    if (!customWhere && !category && !uploader && expunged === 0) {
        const result = await conn.query(
            'SELECT stat_value FROM gallery_stats WHERE stat_key = ?',
            ['total_active']
        );
        if (result && result[0]) {
            return result[0].stat_value;
        }
    }

    // 如果是按分类统计，从缓存表读取
    if (!customWhere && category && !uploader && expunged === 0) {
        const result = await conn.query(
            'SELECT stat_value FROM gallery_stats WHERE stat_key = ?',
            [`category_${category}`]
        );
        if (result && result[0]) {
            return result[0].stat_value;
        }
    }

    // 如果是按上传者统计，从缓存表读取
    if (!customWhere && uploader && expunged === 0) {
        const result = await conn.query(
            'SELECT gallery_count FROM uploader_stats WHERE uploader = ?',
            [uploader]
        );
        if (result && result[0]) {
            return result[0].gallery_count;
        }
    }

    // 复杂条件，回退到实时查询
    let where = ['1=1'];
    const queryParams = [...params];

    if (expunged !== undefined) {
        where.push('expunged = ?');
        queryParams.push(expunged);
    }

    if (category) {
        where.push('category = ?');
        queryParams.push(category);
    }

    if (uploader) {
        where.push('uploader = ?');
        queryParams.push(uploader);
    }

    if (customWhere) {
        where.push(customWhere);
    }

    const result = await conn.query(
        `SELECT COUNT(*) AS total FROM gallery WHERE ${where.join(' AND ')}`,
        queryParams
    );

    return result[0].total;
};

/**
 * 获取标签统计信息
 */
const getTagStats = async (conn, tagName) => {
    const result = await conn.query(
        'SELECT gallery_count FROM tag_stats WHERE tag_name = ?',
        [tagName]
    );
    return result && result[0] ? result[0].gallery_count : null;
};

module.exports = {
    getGalleryCount,
    getTagStats,
};
