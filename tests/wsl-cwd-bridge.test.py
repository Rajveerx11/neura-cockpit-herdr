#!/usr/bin/env python3
"""Test the real WSL bridge against an owned argv-only executable, never Herdr."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

bridge = Path(__file__).resolve().parents[1] / 'wsl/herdr'
root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='bridge-test-', dir=root) as tmp:
    fake = Path(tmp) / 'argv.py'
    fake.write_text('#!/usr/bin/python3\nimport json,sys\nprint(json.dumps(sys.argv[1:]))\n')
    fake.chmod(0o755)
    env = dict(os.environ, HERDR_ENV='1', HERDR_BIN_PATH=subprocess.check_output(
        ['wslpath', '-w', str(fake)], text=True).strip())
    def run(args, expected=None, code=0, environment=env):
        p = subprocess.run([str(bridge), *args], cwd='/mnt/c', env=environment,
                           text=True, capture_output=True)
        assert p.returncode == code, (args, p.returncode, p.stderr)
        if expected is not None:
            assert json.loads(p.stdout) == expected, (args, p.stdout, expected)
    run(['status'], ['status'])
    run([], [])
    run(['pane', 'split', '--cwd', '/mnt/c/Project with spaces'],
        ['pane', 'split', '--cwd', 'C:\\Project with spaces'])
    run(['--cwd=/mnt/c/Project with spaces'],
        ['--cwd=C:\\Project with spaces'])
    run(['--cwd', 'Project with spaces'],
        ['--cwd', 'C:\\Project with spaces'])
    run(['--cwd', 'D:\\Native path'], ['--cwd', 'D:\\Native path'])
    run(['--cwd', '\\\\server\\share\\folder'], ['--cwd', '\\\\server\\share\\folder'])
    run(['agent', 'start', '--', '--cwd', '/mnt/c/raw'],
        ['agent', 'start', '--', '--cwd', '/mnt/c/raw'])
    run(['--cwd'], code=2)
    run(['--cwd='], code=2)
    run(['--cwd', ''], code=2)
    run(['--cwd', '--no-focus'], code=2)
    outside = dict(env)
    outside.pop('HERDR_ENV')
    run(['status'], code=1, environment=outside)
print('PASS: 13 WSL bridge cases; no live Herdr calls.')
