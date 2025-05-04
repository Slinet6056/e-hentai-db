#!/usr/bin/env python3
'''Convert api_dump.sqlite provided by https://sukebei.nyaa.si/user/gipaf23445 (e-hentai_exhentai_metadata_api_dump_gp_crawl_database_archive_*) to gdata.json'''

import sqlite3, sys, ast
try:
    from tqdm import tqdm
except ModuleNotFoundError:
    tqdm = lambda x: x

db = sqlite3.connect(f"file:{sys.argv[1] if len(sys.argv) >=1 else 'api_dump.sqlite'}?mode=ro", uri=True)

def dict_factory(cursor, row):
    fields = [column[0] for column in cursor.description]
    return {key: value for key, value in zip(fields, row)}

db.row_factory = dict_factory

def parse_tags(row: dict):
    row['tags'] = []
    for namespace in ('artist', 'group', 'parody', 'character', 'female', 'male', 'language', 'mixed', 'other', 'cosplayer'):
        if row[namespace] is not None:
            row['tags'] += [namespace+':'+tag for tag in ast.literal_eval(row.pop(namespace))]
    if row['rest'] is not None:
        row['tags'] += ast.literal_eval(row.pop('rest'))
    if row['torrents'] is not None:
        row['torrents'] = ast.literal_eval(row['torrents'])
    return row

gdata = {
    row['gid']: parse_tags(row)
    for row in tqdm(db.execute('SELECT * FROM gallery'))
}

db.close()

try:
    import orjson
    from pathlib import Path
    Path('gdata.json').write_bytes(
        orjson.dumps(
            gdata,
            option=orjson.OPT_NON_STR_KEYS,
        )
    )
except ModuleNotFoundError:
    import json
    with open('gdata.json', 'wt', encoding='utf-8') as f:
        json.dump(gdata, f, ensure_ascii=False)
