1. Download `api_dump.sqlite` from https://sukebei.nyaa.si/user/gipaf23445 (e-hentai_exhentai_metadata_api_dump_gp_crawl_database_archive_*)
2. Use `migration_scripts/api_dump_sqlite2gdata_json.py` convert it to `gdata.json`. It consumes a lot of RAM (over 10GB). You could try optimizing the script (it's not complicated, but I'm too lazy to do it).
3. Modifies the structure of the tables in the database: `mysql -u <USERNAME> -p e-hentai-db < migration_scripts/alter_table_struct.sql`. See the comments in the file for the reasons. You may not agree with them, but it should be easy to customize.
4. Import `gdata.json`: `NODE_OPTIONS="--max-old-space-size=15000" npm run import gdata.json`. This also requires a larger amount of RAM, but not as much.
5. Import torrents from ehentai: `npm run torrent-import [host=e-hentai.org]`. This takes a long time...
