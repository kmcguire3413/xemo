import traceback
import sys
import os
import urllib.parse
import json

def gethttpargs():
    if os.environ['REQUEST_METHOD'] == 'POST':
        _args = sys.stdin.read()
        _args = urllib.parse.parse_qsl(_args)
    else:
        if 'QUERY_STRING' in os.environ:
            _args = os.environ['QUERY_STRING']
            _args = urllib.parse.parse_qsl(_args)
        else:
            _args = None

    if _args is None:
        args = {}
    else:
        args = {}
        for _ in _args:
            args[_[0]] = _[1]
    return args

def start(f):
    try:
        print('Content-Type: text/html; charset=utf-8')
        print('')
        print('')
        print(json.dumps({
            'code':       'success',
            'result':     f(gethttpargs())
        }))
    except Exception as e:
        print(json.dumps({
            'code':        'error',
            'error':        traceback.format_exc()
        }))

