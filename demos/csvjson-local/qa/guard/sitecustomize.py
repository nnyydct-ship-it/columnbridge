"""Test-only guard for ordinary Python socket use, not an OS network sandbox."""
import os
import socket


def denied(*args, **kwargs):
    path = os.environ.get('CSVJSON_QA_SOCKET_LOG')
    if path:
        with open(path, 'a', encoding='utf-8') as handle:
            handle.write('ordinary-python-socket-attempt\n')
    raise RuntimeError('Network disabled by independent test guard')


socket.socket = denied
socket.create_connection = denied
