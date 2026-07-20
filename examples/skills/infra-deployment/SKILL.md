---
name: infra-deployment
description: Deployment methods and conventions — Docker, systemd, and manual deployment patterns
metadata:
  version: 1.0.0
  openfox:
    displayName: Deployment Patterns
---

# Infrastructure Deployment

## Deployment Methods

### Docker Compose

```bash
# Deploy or update a stack
cd /opt/docker/<stack>
docker compose pull
docker compose up -d
docker compose ps

# Check logs
docker compose logs --tail=50
```

### Systemd Service

```bash
# Create or update a service unit
# The unit file goes to /etc/systemd/system/<service>.service
systemctl daemon-reload
systemctl enable --now <service>
systemctl status <service>
```

### Manual Deployment

```bash
# Copy artifacts
rsync -avz ./dist/ <server>:/opt/<app>/

# Restart process
ssh <server> "systemctl restart <service>"
```

## Pre-Deployment Checklist

1. Check disk space: `df -h`
2. Check memory: `free -h`
3. Verify current version: query `infra_get_server(name)` via MCP
4. Plan rollback: ensure previous artifacts are backed up
5. Notify users if the service will be disrupted

## Post-Deployment

1. Verify service is running: `systemctl is-active <service>`
2. Check logs for errors: `journalctl -u <service> --no-pager -n 20`
3. Call `infra_record_change()` to persist the deployment record
4. Update the wiki page with the new version information
