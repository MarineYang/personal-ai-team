"""Build a clean, allowlisted ZIP. Never package user state or credentials."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parent.parent
FILES = [
    'README.md', 'package.json', 'package-lock.json', '.gitignore',
    'server.mjs', '팀 실행.command', 'start.sh',
    'lib/codex.mjs', 'lib/roles.mjs',
    'public/index.html', 'public/style.css', 'public/main.js',
    'public/dashboard.js', 'public/office.js', 'public/app.js',
    'public/vendor/THREE-LICENSE.txt',
    'scripts/doctor.mjs', 'scripts/launch.mjs', 'scripts/package_release.py',
    'scripts/backend.test.mjs', 'scripts/smoke.mjs',
]

def build():
    version = json.loads((ROOT / 'package.json').read_text())['version']
    if not all(c.isdigit() or c == '.' for c in version):
        raise ValueError('Invalid release version')
    output = ROOT / 'dist' / f'teamroom-{version}.zip'
    output.parent.mkdir(exist_ok=True)
    manifest = {}
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for relative in FILES:
            source = ROOT / relative
            if source.is_symlink() or not source.is_file():
                raise ValueError(f'Release requires regular file: {relative}')
            data = source.read_bytes()
            manifest[relative] = hashlib.sha256(data).hexdigest()
            archive.write(source, 'teamroom/' + relative)
        archive.writestr('teamroom/RELEASE-MANIFEST.json', json.dumps(manifest, indent=2))
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == {'teamroom/' + x for x in FILES} | {'teamroom/RELEASE-MANIFEST.json'}
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix('.zip.sha256').write_text(f'{digest}  {output.name}\n')
    print(f'{output}\n{len(FILES)} files; no runtime, workspace or account data\nSHA256 {digest}')

if __name__ == '__main__':
    build()
