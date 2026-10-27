"""Validate release ZIPs with Python's independent standard-library reader."""
import argparse
import io
import json
import sys
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
EXPECTED_ORDERS = {'sample-single-chapter.zip': [3], 'sample-multi-skip.zip': [1, 3]}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def image_extension(data):
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'png'
    if data.startswith(b'\xff\xd8\xff'):
        return 'jpg'
    if data.startswith((b'GIF87a', b'GIF89a')):
        return 'gif'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'webp'
    if data[4:8] == b'ftyp' and any(brand in data[8:64] for brand in [b'avif', b'avis']):
        return 'avif'
    return None


def verify(name, raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = [entry for entry in archive.infolist() if not entry.is_dir()]
        require(bool(entries), f'{name}: archive contains no readable entries')
        names = [entry.filename for entry in entries]
        require(len(names) == len(set(names)), f'{name}: duplicate entries')
        require(archive.testzip() is None, f'{name}: CRC check failed')
        require(all(entry.compress_type == zipfile.ZIP_STORED for entry in entries), 'Only STORE entries are allowed')
        require(all(not PurePosixPath(item).is_absolute() and '..' not in PurePosixPath(item).parts for item in names), 'Unsafe entry path')
        reports = [item for item in names if item.endswith('/download-report.json')]
        require(len(reports) == 1, 'Expected one download-report.json under the comic root')
        report = json.loads(archive.read(reports[0]))
        require(report['version'] == VERSION, 'Report and release versions differ')
        require(report['result'] in ['complete', 'partial'], 'Unexpected result status')
        root = reports[0].rsplit('/', 1)[0]
        require(all(item.startswith(root + '/') for item in names), 'Entries have different comic roots')
        orders = [chapter['order'] for chapter in report['chapters']]
        if name in EXPECTED_ORDERS:
            require(orders == EXPECTED_ORDERS[name], 'Skipped chapters were renumbered')
        require(orders == sorted(orders), 'Chapter entries are not in canonical order')
        total_images = 0
        for chapter in report['chapters']:
            folder = chapter['folder']
            require(folder.startswith(f"{chapter['order']:04d}_"), 'Chapter folder lost its full-catalog index')
            prefix = f'{root}/{folder}/'
            pages = [item for item in names if item.startswith(prefix)]
            missing = [item['page'] for item in chapter['missing']]
            require(len(missing) == len(set(missing)), 'Duplicate missing-page records')
            expected = set(range(1, chapter['expectedPages'] + 1))
            require(set(missing) <= expected, 'Missing-page numbers are outside the chapter')
            actual = set()
            for item in pages:
                leaf = item.rsplit('/', 1)[1]
                stem, extension = leaf.rsplit('.', 1)
                number = int(stem)
                require(leaf == f'{number:04d}.{extension}', 'Page filename padding is invalid')
                require(number not in actual, 'Duplicate page number')
                actual.add(number)
                require(image_extension(archive.read(item)) == extension, f'Image format mismatch: {item}')
            require(actual == expected - set(missing), 'Page filenames and report page numbers differ')
            require(len(pages) == chapter['savedPages'], 'Saved-page count differs from ZIP contents')
            if report['result'] == 'complete':
                require(not missing, 'Complete report lists missing pages')
            total_images += len(pages)
        require(total_images + 1 == len(entries), 'Unexpected files outside the report')
        result = {'archive': name, 'entries': len(entries), 'images': total_images,
                  'chapterOrders': orders, 'version': VERSION,
                  'checks': 'CRC / STORE / filenames / format / report: PASS'}
        print(json.dumps(result, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stdin', metavar='ARCHIVE_NAME', help='Verify ZIP bytes from stdin without writing them')
    parser.add_argument('files', nargs='*')
    args = parser.parse_args()
    if args.stdin:
        verify(args.stdin, sys.stdin.buffer.read())
    else:
        paths = [Path(item) for item in args.files] or [ROOT / 'samples' / name for name in EXPECTED_ORDERS]
        for path in paths:
            verify(path.name, path.read_bytes())


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    try:
        main()
    except (ValueError, KeyError, OSError, zipfile.BadZipFile) as error:
        print(f'ZIP verification failed: {error}', file=sys.stderr)
        sys.exit(1)
