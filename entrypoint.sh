#!/bin/sh

# Create sync scripts
cat >/app/run-sync.sh <<'EOF'
#!/bin/sh
cd /app
echo "[$(date)] Starting sync..."
pnpm run sync ${SYNC_HOST:-e-hentai.org} 2>&1 | while IFS= read -r line; do
    echo "[$(date)] $line"
done
echo "[$(date)] Sync completed"
EOF
chmod +x /app/run-sync.sh

cat >/app/run-resync.sh <<'EOF'
#!/bin/sh
cd /app
HOURS=${RESYNC_HOURS:-24}
echo "[$(date)] Starting resync for last $HOURS hours..."
pnpm run resync $HOURS 2>&1 | while IFS= read -r line; do
    echo "[$(date)] $line"
done
echo "[$(date)] Resync completed"
EOF
chmod +x /app/run-resync.sh

cat >/app/run-torrent-sync.sh <<'EOF'
#!/bin/sh
cd /app
echo "[$(date)] Starting torrent sync..."
pnpm run torrent-sync ${SYNC_HOST:-e-hentai.org} 2>&1 | while IFS= read -r line; do
    echo "[$(date)] $line"
done
echo "[$(date)] Torrent sync completed"
EOF
chmod +x /app/run-torrent-sync.sh

# Create crontab file
echo "# E-Hentai DB Auto Sync Tasks" >/etc/crontabs/root

CRON_ENABLED=false

# Add sync task if enabled
if [ "$ENABLE_SYNC" = "true" ]; then
    SYNC_SCHEDULE="${SYNC_INTERVAL:-0 */6 * * *}"
    echo "$SYNC_SCHEDULE /app/run-sync.sh >> /proc/1/fd/1 2>&1" >>/etc/crontabs/root
    echo "Sync enabled: $SYNC_SCHEDULE"
    CRON_ENABLED=true
fi

# Add resync task if enabled
if [ "$ENABLE_RESYNC" = "true" ]; then
    RESYNC_SCHEDULE="${RESYNC_INTERVAL:-0 2 * * *}"
    echo "$RESYNC_SCHEDULE /app/run-resync.sh >> /proc/1/fd/1 2>&1" >>/etc/crontabs/root
    echo "Resync enabled: $RESYNC_SCHEDULE (last ${RESYNC_HOURS:-24} hours)"
    CRON_ENABLED=true
fi

# Add torrent sync task if enabled
if [ "$ENABLE_TORRENT_SYNC" = "true" ]; then
    TORRENT_SCHEDULE="${TORRENT_SYNC_INTERVAL:-0 0 * * *}"
    echo "$TORRENT_SCHEDULE /app/run-torrent-sync.sh >> /proc/1/fd/1 2>&1" >>/etc/crontabs/root
    echo "Torrent sync enabled: $TORRENT_SCHEDULE"
    CRON_ENABLED=true
fi

# Start cron daemon if any sync is enabled
if [ "$CRON_ENABLED" = "true" ]; then
    echo ""
    echo "Crontab configuration:"
    cat /etc/crontabs/root

    crond -b -l 2
    echo ""
    echo "Cron daemon started"
fi

# Start application
echo ""
echo "Starting E-Hentai DB service..."
exec pnpm start
