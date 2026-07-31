import { describe, expect, it } from 'vitest'
import { detectRemoteExecution } from './remote-execution'

describe('detectRemoteExecution', () => {
  it.each([
    ['ssh example.com', 'SSH'],
    ['/usr/bin/scp file.txt example.com:/tmp', 'SCP'],
    ['sftp example.com', 'SFTP'],
    ['mosh example.com', 'MOSH'],
    ['cd /tmp && ssh example.com', 'SSH'],
    ['echo ready\nssh example.com', 'SSH'],
    ['sleep 1 & ssh example.com', 'SSH'],
    ['sudo -u deploy ssh example.com', 'SSH'],
    ['sudo --chdir /tmp ssh example.com', 'SSH'],
    ['sudo --chdir=/tmp ssh example.com', 'SSH'],
    ['sshpass -p password ssh example.com', 'SSH'],
    ['sshpass -f /tmp/pass ssh user@host "echo ok"', 'SSH'],
    ['sshpass -e scp file host:/tmp', 'SCP'],
    ['sshpass -d 3 sftp host', 'SFTP'],
    ['sudo sshpass -p pass ssh host', 'SSH'],
    ['nix shell nixpkgs#sshpass -c sshpass -p pass ssh example.com', 'SSH'],
    ['nix shell -c ssh example.com', 'SSH'],
    ['nix shell nixpkgs#foo -c scp file host:/tmp', 'SCP'],
    ['nix develop -c ssh host', 'SSH'],
    ['nix run nixpkgs#ssh -- user@host "echo ok"', 'SSH'],
    ['nix run nixpkgs#scp -- file host:/tmp', 'SCP'],
    ['env TERM=xterm sftp example.com', 'SFTP'],
    ['env -u SSH_AUTH_SOCK ssh example.com', 'SSH'],
    ["env -S 'ssh example.com'", 'SSH'],
    ["env --split-string='ssh example.com'", 'SSH'],
    ['sudo -u deploy env TERM=x ssh example.com', 'SSH'],
    ['nohup env ssh example.com', 'SSH'],
    ['setsid ssh example.com', 'SSH'],
    ['nohup scp file example.com:/tmp', 'SCP'],
    ['timeout 10s sftp example.com', 'SFTP'],
    ['command mosh example.com', 'MOSH'],
    ['( ssh example.com )', 'SSH'],
    ['{ scp file example.com:/tmp; }', 'SCP'],
    ['if true; then sftp example.com; fi', 'SFTP'],
    ['while true; do mosh example.com; done', 'MOSH'],
    ["bash -lc 'ssh example.com'", 'SSH'],
    ["bash -c -- 'ssh example.com'", 'SSH'],
    ["bash -lc -- 'ssh example.com'", 'SSH'],
    ['sh -c "setsid sftp example.com"', 'SFTP'],
    ["zsh -lc 'nohup mosh example.com'", 'MOSH'],
    ["fish -c 'timeout 5 scp file example.com:/tmp'", 'SCP'],
    ["bash -lc 'cd /tmp && ssh example.com'", 'SSH'],
    ['echo "$(ssh example.com)"', 'SSH'],
    ['echo `sftp example.com`', 'SFTP'],
    ['value=$(scp file example.com:/tmp)', 'SCP'],
    ["printf '<<EOF\\n'\nssh example.com", 'SSH'],
    ['echo <<<EOF\nssh example.com', 'SSH'],
    ["cat <<'EOF-1'\ndata\nEOF-1\nssh example.com", 'SSH'],
    ["cat <<'EO'F\ndata\nEOF\nssh example.com", 'SSH'],
    ['cat <<E"O"F\ndata\nEOF\nssh example.com', 'SSH'],
    ['cat <<\\EOF\ndata\nEOF\nssh example.com', 'SSH'],
    ["cat <<$'EOF'\ndata\nEOF\nssh example.com", 'SSH'],
    ['cat <<"E\\OF"\ndata\nE\\OF\nssh example.com', 'SSH'],
    ["cat <<$'E\\x4fF'\ndata\nEOF\nssh example.com", 'SSH'],
    ['cat <<EOF\n$(ssh example.com)\nEOF', 'SSH'],
    ['cat <<EOF\n# $(ssh example.com)\nEOF', 'SSH'],
    ['cat <<EOF\n# `ssh example.com`\nEOF', 'SSH'],
    ['echo ""# $(ssh example.com)', 'SSH'],
    ["echo ''# `ssh example.com`", 'SSH'],
    ["echo '$(( '; ssh example.com; echo '))'", 'SSH'],
    ['echo ""#local; ssh example.com', 'SSH'],
    ["echo ''#local; ssh example.com", 'SSH'],
    [
      `bash -lc 'askpass=$(mktemp); trap "rm -f \\"$askpass\\"" EXIT; printf "#!/bin/sh\\nprintf %s\\n %s\\n" '"'"'example-password'"'"' > "$askpass"; chmod 700 "$askpass"; export SSH_ASKPASS="$askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0; setsid ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -o PreferredAuthentications=password -o PubkeyAuthentication=no user@example.test "echo PASS"'`,
      'SSH',
    ],
  ])('detects %s as %s', (command, expected) => {
    expect(detectRemoteExecution('run_command', { command })).toBe(expected)
  })

  it.each([
    'echo ssh',
    'cat ~/.ssh/config',
    'grep sftp README.md',
    'printf "mosh"',
    'ssh-keygen -t ed25519',
    'FOO="local; ssh host" echo ok',
    "echo 'ssh host'",
    'echo "ssh host"',
    'echo local # ; ssh host',
    'echo local # ssh host',
    "bash -lc 'echo ssh'",
    "sh -c 'cat ~/.ssh/config'",
    "bash -lc 'echo local # ssh host'",
    "printf '%s' \"bash -lc 'ssh host'\"",
    'command -v ssh',
    'command -V ssh',
    "bash -n -c 'ssh host'",
    "bash -nc 'ssh host'",
    "'' ssh host",
    "cat <<'EOF'\nssh production\nEOF",
    'cat <<-EOF\n\tssh production\nEOF',
    'cat <<"END"\nssh production\nEND',
    "echo '\u0024(ssh host)'",
    "echo '`ssh host`'",
    'echo ok # $(ssh host)',
    'echo ok # `ssh host`',
    'echo $((ssh))',
    "cat <<'EOF'\n$(ssh host)\nEOF",
    'cat <<"EOF"\n`ssh host`\nEOF',
    'for ssh in one two; do echo $ssh; done',
    'select sftp in one two; do echo $sftp; done',
    'case value in one) echo one;; ssh) echo match;; esac',
  ])('does not treat %s as remote execution', (command) => {
    expect(detectRemoteExecution('run_command', { command })).toBeNull()
  })

  it.each(['echo foo#bar; ssh host', 'echo "#"; ssh host', "echo '#'; ssh host"])(
    'preserves literal hashes in %s',
    (command) => {
      expect(detectRemoteExecution('run_command', { command })).toBe('SSH')
    },
  )

  it('only detects remote execution for run_command', () => {
    expect(detectRemoteExecution('write_file', { command: 'ssh example.com' })).toBeNull()
  })
})
