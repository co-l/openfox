---
name: infra-ssh
description: SSH access conventions — alias usage, key selection, and best practices for connecting to infrastructure servers
metadata:
  version: 1.0.0
  openfox:
    displayName: SSH Infrastructure
---

# SSH Infrastructure Access

## Convention: Use SSH Aliases

Always use SSH host aliases from `~/.ssh/config` — never type raw IP addresses.

```bash
ssh <alias>          # connect
rsync -avz file <alias>:/path/   # copy files
ssh <alias> "command"            # one-shot remote command
```

## Key Selection

- Default key (`~/.ssh/id_ed25519`) for most servers
- Use `ssh -i <keyfile>` when a server requires a specific key
- Check `~/.ssh/config` for `IdentityFile` directives per host

## Connection Check

```bash
ssh -O check <alias>   # check if master socket is active
ssh <alias> hostname   # quick connectivity test
```

## Security Rules

- Prefer SSH key auth over passwords
- Never store private keys in repositories or skills
- Use SSH agent forwarding only when explicitly needed
- Verify host keys on first connection to untrusted networks
