import json
import subprocess
from types import SimpleNamespace

import httpx
import pytest

from variant_maker.diagnostics import failure_diagnostic, log_http_failure


@pytest.mark.parametrize("secret", [
    'https://example.test/private/video.mp4?X-Amz-Signature=super-secret',
    '/Users/private/person name/video.mp4',
    'Authorization: Bearer secret-token',
    'password=unusual!secret api_key=key-secret',
    'customer@example.test subtitle: private user content',
    '\x1b[31mSECRET\nforged log entry\r\n',
])
def test_output_contains_only_allowlisted_labels(secret):
    output = failure_diagnostic('ffmpeg', 'Invalid argument ' + secret, 187)
    assert json.loads(output) == {
        'event': 'render_failure_diagnostic', 'stage': 'ffmpeg',
        'hints': ['invalid_argument'], 'code': 187,
    }
    assert secret not in output


def test_unknown_text_objects_stages_and_codes_are_not_serialized():
    class Private:
        def __str__(self):
            raise AssertionError('must never stringify')
    assert json.loads(failure_diagnostic('secret-stage', Private(), 'secret-code')) == {
        'event': 'render_failure_diagnostic', 'stage': 'unknown', 'hints': ['unknown'],
    }


def test_input_and_output_bounded():
    output = failure_diagnostic('ffmpeg', 'x' * 8192 + ' out of memory SECRET', 10**100)
    assert len(output) < 128
    assert json.loads(output)['hints'] == ['unknown']
    assert 'code' not in json.loads(output)


def test_http_failure_does_not_expose_body_url_headers(capsys):
    response = httpx.Response(409, text='Conflict secret-token https://private.test/path',
        request=httpx.Request('POST', 'https://private.test/endpoint',
                              headers={'Authorization': 'Bearer secret-token'}))
    log_http_failure(response, 'runpod_submit')
    assert json.loads(capsys.readouterr().out) == {
        'event': 'render_failure_diagnostic', 'stage': 'runpod_submit',
        'hints': ['conflict'], 'code': 409,
    }


def test_success_response_does_not_read_text(capsys):
    class Response:
        status_code = 200
        @property
        def text(self):
            raise AssertionError('must not read successful content')
    log_http_failure(Response(), 'runpod_submit')
    assert capsys.readouterr().out == ''


def test_ffmpeg_failure_preserves_exception_and_runs_once(monkeypatch, capsys):
    import variant_maker.ffmpeg as ff
    calls = []
    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        return SimpleNamespace(returncode=187, args=cmd, stdout='',
                               stderr='Invalid argument /private/secret.mp4')
    monkeypatch.setattr(ff.subprocess, 'run', fake_run)
    with pytest.raises(subprocess.CalledProcessError) as caught:
        ff.run(['ffmpeg', 'secret'])
    assert caught.value.returncode == 187
    assert caught.value.stderr == 'Invalid argument /private/secret.mp4'
    assert calls == [['ffmpeg', 'secret']]
    assert json.loads(capsys.readouterr().out)['hints'] == ['invalid_argument']


def test_runpod_submission_failure_no_extra_request_or_retry(monkeypatch, capsys):
    import variant_maker.server.runpod_client as rc
    calls = []
    class Http:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, url, **kwargs):
            calls.append('post')
            return httpx.Response(409, text='Conflict private content',
                                  request=httpx.Request('POST', url))
        def get(self, *args, **kwargs):
            raise AssertionError('No polling or retry after failed submission')
    monkeypatch.setattr(rc, '_http', Http)
    with pytest.raises(httpx.HTTPStatusError):
        list(rc.HttpRunPodClient(endpoint_id='private', api_key='secret').stream_run({}))
    assert calls == ['post']
    assert json.loads(capsys.readouterr().out)['stage'] == 'runpod_submit'
