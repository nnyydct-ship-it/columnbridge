#!/usr/bin/env python3
"""Independent synthetic black-box checks; no client data or network."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

CLI = Path(__file__).resolve().parents[1] / 'csvjson.py'
RESULT = Path(__file__).resolve().parent / 'result.json'
cases = []


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_case(name, raw, expected=None, args=(), rejection=False, output_kind=None):
    with tempfile.TemporaryDirectory(prefix='csvjson-qa-') as tmp:
        root = Path(tmp)
        source = root / 'input.csv'
        output = root / 'output.json'
        source.write_bytes(raw)
        before = digest(source)
        if output_kind == 'existing':
            output.write_text('KEEP EXISTING')
        elif output_kind == 'symlink':
            output.symlink_to(source)
        elif output_kind == 'dangling':
            output.symlink_to(root / 'absent')
        elif output_kind == 'hardlink':
            os.link(source, output)
        elif output_kind == 'directory':
            output.mkdir()
        elif output_kind == 'same':
            output = source
        before_output = output.read_bytes() if output.is_file() else None
        socket_log = root / 'socket.log'
        env = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parent / 'guard'),
                   PYTHONDONTWRITEBYTECODE='1', CSVJSON_QA_SOCKET_LOG=str(socket_log))
        p = subprocess.run([sys.executable, str(CLI), str(source), '--output', str(output), *args],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, env=env)
        checks = {'input_unchanged': digest(source) == before}
        checks['no_ordinary_python_socket_attempts'] = not socket_log.exists()
        if rejection:
            checks['nonzero_exit'] = p.returncode != 0
            checks['no_success_claim'] = not p.stdout.strip()
            if before_output is not None:
                checks['existing_output_unchanged'] = output.read_bytes() == before_output
            elif output_kind == 'dangling':
                checks['dangling_symlink_preserved'] = output.is_symlink() and not output.exists()
            elif output_kind == 'directory':
                checks['directory_preserved'] = output.is_dir()
            else:
                checks['no_output_on_error'] = not output.exists()
        else:
            checks['zero_exit'] = p.returncode == 0
            try:
                checks['exact_json'] = json.loads(output.read_text()) == expected
                checks['mode_0600'] = output.stat().st_mode & 0o777 == 0o600
            except (OSError, ValueError):
                checks['exact_json'] = False
                checks['mode_0600'] = False
        leftovers = sorted(x.name for x in root.iterdir() if x.name not in {'input.csv', 'output.json'})
        checks['no_temp_leftovers'] = not leftovers
        cases.append({'name': name, 'passed': all(checks.values()), 'checks': checks,
                      'exit': p.returncode, 'stderr': p.stderr.decode(errors='replace')[:500]})


def main():
    with tempfile.TemporaryDirectory(prefix='csvjson-guard-control-') as tmp:
        log = Path(tmp) / 'socket.log'
        env = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parent / 'guard'),
                   PYTHONDONTWRITEBYTECODE='1', CSVJSON_QA_SOCKET_LOG=str(log))
        control = subprocess.run([sys.executable, '-c', 'import socket; socket.socket()'],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=10)
        guard_ok = control.returncode != 0 and log.exists() and 'Network disabled' in control.stderr.decode(errors='replace')
    before_cli = digest(CLI)
    run_case('comma', b'name,age\r\nAda,007\r\n', [{'name': 'Ada', 'age': '007'}])
    run_case('bom_unicode', '\ufeff城市,话语\r\n首尔,你好😀\r\n'.encode(), [{'城市': '首尔', '话语': '你好😀'}])
    run_case('quoted_commas_quotes', b'a,b\r\n"hello, world","she said ""yes"""\r\n', [{'a': 'hello, world', 'b': 'she said "yes"'}])
    run_case('quoted_crlf', b'a,b\r\n"one\r\ntwo",x\r\n', [{'a': 'one\r\ntwo', 'b': 'x'}])
    run_case('tab', b'a\tb\n1\t2\n', [{'a': '1', 'b': '2'}], ('--delimiter', 'tab'))
    run_case('semicolon', b'a;b\n1;2\n', [{'a': '1', 'b': '2'}], ('--delimiter', 'semicolon'))
    run_case('pipe', b'a|b\n1|2\n', [{'a': '1', 'b': '2'}], ('--delimiter', 'pipe'))
    run_case('custom_delimiter', b'a:b\nx:y\n', [{'a': 'x', 'b': 'y'}], ('--delimiter', ':'))
    run_case('single_quote', b"a,b\n'x,y',z\n", [{'a': 'x,y', 'b': 'z'}], ('--quotechar', "'"))
    run_case('strings_not_coerced', b'a,b,c,d\n001,true,null,1e99\n', [{'a': '001', 'b': 'true', 'c': 'null', 'd': '1e99'}])
    run_case('json_escaping', b'a,b\n"\\path\\q","\tend"\n', [{'a': '\\path\\q', 'b': '\tend'}])
    run_case('binary_nul_rejected', b'a\n\x00\n', rejection=True)
    run_case('formula_preserved', b'a\n=1+1\n', [{'a': '=1+1'}])
    run_case('empty_cells', b'a,b\n,\n', [{'a': '', 'b': ''}])
    run_case('header_only', b'a,b\n', [])
    run_case('duplicate_header', b'a,a\n1,2\n', rejection=True)
    run_case('empty_header', b'a,\n1,2\n', rejection=True)
    run_case('space_header', b'a,  \n1,2\n', rejection=True)
    run_case('row_too_long', b'a,b\n1,2,3\n', rejection=True)
    run_case('row_too_short', b'a,b\n1\n', rejection=True)
    run_case('late_bad_row_no_partial_output', b'a,b\n1,2\n3\n', rejection=True)
    run_case('unterminated_quote', b'a,b\n"oops,x\n', rejection=True)
    run_case('junk_after_closing_quote', b'a,b\n"x"junk,y\n', rejection=True)
    run_case('invalid_utf8', b'a\n\xff\n', rejection=True)
    run_case('empty_input', b'', rejection=True)
    run_case('byte_limit', b'a,b\n123,456\n', args=('--max-bytes', '5'), rejection=True)
    run_case('field_limit', b'a,b\n123456,1\n', args=('--max-field-chars', '3'), rejection=True)
    for kind in ['existing', 'symlink', 'dangling', 'hardlink', 'directory', 'same']:
        run_case('reject_output_' + kind, b'a,b\n1,2\n', rejection=True, output_kind=kind)
    for key in ['--delimiter', '--quotechar']:
        run_case('bad_' + key[2:], b'a,b\n1,2\n', args=(key, 'ab'), rejection=True)
    after_cli = digest(CLI)
    report = {'synthetic_only': True, 'client_work_accepted': False,
              'ordinary_python_sockets_disabled': True, 'os_network_syscalls_measured': False,
              'guard_control_passed': guard_ok,
              'cli_sha256': before_cli, 'cli_unchanged': before_cli == after_cli,
              'checks': len(cases), 'passed': sum(x['passed'] for x in cases), 'cases': cases}
    RESULT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k:v for k,v in report.items() if k != 'cases'}))
    for item in cases:
        if not item['passed']:
            print(json.dumps(item, ensure_ascii=False))
    return 0 if all(x['passed'] for x in cases) and report['cli_unchanged'] and guard_ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
