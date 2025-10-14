const mysql = require('mysql');
const fs = require('fs');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const config = require('../config');

const proxy = process.env.ALL_PROXY || process.env.all_proxy || process.env.HTTPS_PROXY || process.env.https_proxy;

let agent = null;
if (proxy) {
    console.log(`using proxy: ${proxy}`);
    if (proxy.startsWith('http')) {
        agent = new HttpsProxyAgent(proxy);
    } else if (proxy.startsWith('socks')) {
        agent = new SocksProxyAgent(proxy);
    }
}

class FavoriteSync {
    constructor() {
        this.query = this.query.bind(this);
        this.run = this.run.bind(this);
        this.host = 'exhentai.org';
        this.cookies = this.loadCookies();
        this.retryTimes = 3;
        this.connection = this.initConnection();
    }

    initConnection() {
        const connection = mysql.createConnection({
            host: config.dbHost,
            port: config.dbPort,
            user: config.dbUser,
            password: config.dbPass,
            database: config.dbName,
            timeout: 10e3,
        });
        connection.on('error', (err) => {
            console.error(err);
            this.connection = this.initConnection();
            this.connection.connect();
        });
        return connection;
    }

    query(...args) {
        return new Promise((resolve, reject) => {
            try {
                this.connection.query(...args, (error, results) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve(results);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    loadCookies() {
        try {
            return fs.readFileSync('.cookies', 'utf8');
        } catch (err) {
            console.error('Failed to load .cookies file. Please ensure it exists for accessing favorites.');
            return '';
        }
    }

    async retryResolver(fn, time = 1, ...args) {
        for (let i = 0; i < time; i++) {
            try {
                return await fn(...args);
            } catch (err) {
                console.log(err.stack || err);
                if (i < time - 1) {
                    await this.sleep(1);
                }
            }
        }
        throw new Error('Exceed maximum retry time');
    }

    getFavoritePage(favcat = 'all', next = '') {
        return new Promise((resolve, reject) => {
            try {
                const path = `/favorites.php?favcat=${favcat}&inline_set=fs_f${next ? `&next=${next}` : ''}`;
                const request = https.request({
                    method: 'GET',
                    hostname: this.host,
                    path: path,
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*',
                        'Accept-Language': 'en-US;q=0.9,en;q=0.8',
                        'DNT': 1,
                        'Referer': `https://${this.host}/favorites.php`,
                        'Upgrade-Insecure-Requests': 1,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.142 Safari/537.36',
                        ...(!!this.cookies && { cookie: this.cookies })
                    },
                    agent: agent,
                }, (res) => {
                    // Handle 302 redirect
                    if (res.statusCode === 302 || res.statusCode === 301) {
                        const location = res.headers.location;
                        if (location) {
                            // Extract the redirected path
                            const redirectPath = location.startsWith('http')
                                ? new URL(location).pathname + new URL(location).search
                                : location;

                            // Make a new request to the redirect location
                            const redirectRequest = https.request({
                                method: 'GET',
                                hostname: this.host,
                                path: redirectPath,
                                headers: {
                                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*',
                                    'Accept-Language': 'en-US;q=0.9,en;q=0.8',
                                    'DNT': 1,
                                    'Referer': `https://${this.host}/favorites.php`,
                                    'Upgrade-Insecure-Requests': 1,
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.142 Safari/537.36',
                                    ...(!!this.cookies && { cookie: this.cookies })
                                },
                                agent: agent,
                            }, (redirectRes) => {
                                this.handleResponse(redirectRes, resolve, reject);
                            });
                            redirectRequest.on('error', reject);
                            redirectRequest.end();
                            return;
                        }
                    }

                    if (res.statusCode !== 200) {
                        reject(new Error(`HTTP ${res.statusCode}`));
                        return;
                    }

                    this.handleResponse(res, resolve, reject);
                });

                request.on('error', reject);
                request.end();
            } catch (err) {
                reject(err);
            }
        });
    }

    handleResponse(res, resolve, reject) {
        let response = '';
        res.setEncoding('utf8');
        res.on('data', chunk => response += chunk);
        res.on('end', () => {
            try {
                // Extract favorite items from the page (similar to sync.js)
                const list = response.match(/\/g\/\d+\/[0-9a-f]{10}\//g);

                if (!list || list.length === 0) {
                    resolve({
                        items: [],
                        nextToken: null
                    });
                    return;
                }

                const gidTokenPairs = new Set();
                const items = [];

                list.forEach(e => {
                    const [, gid, token] = e.match(/\/g\/(\d+)\/([0-9a-f]{10})\//) || [];
                    if (gid && token) {
                        const key = `${gid}_${token}`;
                        if (!gidTokenPairs.has(key)) {
                            gidTokenPairs.add(key);
                            items.push({
                                gid: parseInt(gid),
                                token: token,
                                favtime: null
                            });
                        }
                    }
                });

                // Extract favorite time for each item
                // Format: <div><p>Favorited:</p><p>2025-10-11 12:54</p></div>
                const favtimeRegex = /<div[^>]*>[\s\S]*?<p>Favorited:<\/p>[\s\S]*?<p>([\d\-\s:]+)<\/p>[\s\S]*?<\/div>/gi;
                const favtimes = [];
                let match;
                while ((match = favtimeRegex.exec(response)) !== null) {
                    favtimes.push(match[1].trim());
                }

                // Match favorite times to items
                items.forEach((item, index) => {
                    if (index < favtimes.length) {
                        const favtimeStr = favtimes[index];
                        // Parse format "2025-10-11 12:54" to timestamp
                        const date = new Date(favtimeStr.replace(' ', 'T') + ':00');
                        if (!isNaN(date.getTime())) {
                            item.favtime = Math.floor(date.getTime() / 1000);
                        }
                    }
                });

                // Extract next token from the page
                // Format: next=GID-TIMESTAMP (e.g., next=2648558-1692758196)
                const nextMatch = response.match(/favorites\.php\?[^"']*next=(\d+-\d+)/);
                const nextToken = nextMatch ? nextMatch[1] : null;

                resolve({
                    items,
                    nextToken
                });
            }
            catch (err) {
                reject(err);
            }
        });
    }

    sleep(time) {
        return new Promise(resolve => setTimeout(resolve, time * 1000));
    }

    async run() {
        const { connection } = this;

        connection.connect(async (err) => {
            if (err) {
                console.error(err.stack);
                return;
            }

            console.log(`connected as id ${connection.threadId}`);
            await this.query('SET NAMES UTF8MB4');

            const allFavorites = [];

            // Sync all 10 favorite categories (0-9)
            for (let favcat = 0; favcat <= 9; favcat++) {
                console.log(`\nSyncing favorite category ${favcat}...`);
                let nextToken = '';
                let pageNum = 0;

                while (true) {
                    await this.sleep(1);
                    console.log(`Requesting page ${pageNum}...`);

                    try {
                        const result = await this.retryResolver(
                            () => this.getFavoritePage(favcat, nextToken),
                            this.retryTimes
                        );

                        if (result.items.length === 0) {
                            console.log(`Category ${favcat} complete (no items)`);
                            break;
                        }

                        console.log(`Got ${result.items.length} items`);

                        result.items.forEach(item => {
                            allFavorites.push({
                                gid: item.gid,
                                favcat: favcat,
                                favtime: item.favtime
                            });
                        });

                        if (!result.nextToken) {
                            console.log(`Category ${favcat} complete`);
                            break;
                        }

                        nextToken = result.nextToken;
                        pageNum++;
                    } catch (error) {
                        console.error(`Error fetching category ${favcat}:`, error.message);
                        break;
                    }
                }
            }

            console.log(`\nTotal favorites collected: ${allFavorites.length}`);

            if (allFavorites.length === 0) {
                console.log('No favorites to sync');
                connection.destroy();
                return;
            }

            // Clear existing favorites and insert new ones
            console.log('Clearing existing favorites...');
            await this.query('DELETE FROM favorite');

            console.log('Inserting favorites...');
            let inserted = 0;
            let skipped = 0;
            let noFavtime = 0;
            const now = Math.floor(Date.now() / 1000);

            for (const item of allFavorites) {
                try {
                    // Check if gallery exists in database
                    const gallery = await this.query('SELECT gid FROM gallery WHERE gid = ?', [item.gid]);

                    if (gallery.length === 0) {
                        skipped++;
                        if (skipped % 100 === 0) {
                            console.log(`Skipped ${skipped} galleries not in database`);
                        }
                        continue;
                    }

                    // Use extracted favtime if available, otherwise use current time
                    const favtime = item.favtime || now;
                    if (!item.favtime) {
                        noFavtime++;
                    }

                    await this.query('INSERT INTO favorite (gid, favcat, favtime) VALUES (?, ?, ?)',
                        [item.gid, item.favcat, favtime]);
                    inserted++;

                    if (inserted % 100 === 0) {
                        console.log(`Inserted ${inserted} favorites`);
                    }
                } catch (error) {
                    console.error(`Error inserting favorite gid=${item.gid}:`, error.message);
                }
            }

            console.log(`\nFavorite sync completed:`);
            console.log(`  - Inserted: ${inserted}`);
            console.log(`  - Skipped (not in gallery table): ${skipped}`);
            if (noFavtime > 0) {
                console.log(`  - No favtime extracted: ${noFavtime}`);
            }

            connection.destroy();
        });
    }
}

process.on('unhandledRejection', (err) => {
    console.log(err.stack);
    if (instance && instance.connection) {
        instance.connection.destroy();
    }
});

const instance = new FavoriteSync();
instance.run().catch(err => {
    console.log(err.stack);
    if (instance && instance.connection) {
        instance.connection.destroy();
    }
});
