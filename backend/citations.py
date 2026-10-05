import re
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

def parse_timestamp(value: str) -> int:
    """MM:SS[.mmm] or HH:MM:SS[.mmm], without floating-point rounding."""
    if not re.fullmatch(r'\d{1,6}:\d{2}(?::\d{2})?(?:\.\d{1,3})?', value):
        raise ValueError('Use MM:SS or HH:MM:SS, optionally with milliseconds.')
    main, _, fraction = value.partition('.')
    parts = [int(p) for p in main.split(':')]
    if parts[-1] >= 60 or (len(parts) == 3 and parts[1] >= 60):
        raise ValueError('Seconds and the minutes field in HH:MM:SS must be below 60.')
    seconds = parts[-1] + parts[-2] * 60 + (parts[0] * 3600 if len(parts) == 3 else 0)
    return seconds * 1000 + int(fraction.ljust(3, '0') or '0')

def format_timestamp(ms: int) -> str:
    seconds, fraction = divmod(ms, 1000)
    hours, seconds = divmod(seconds, 3600)
    minutes, seconds = divmod(seconds, 60)
    text = f'{hours:02}:{minutes:02}:{seconds:02}' if hours else f'{minutes:02}:{seconds:02}'
    return text + (f'.{fraction:03}' if fraction else '')

def timed_link(url: str, start_ms: int) -> str:
    parts = urlsplit(url)
    if parts.hostname in {'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'}:
        query = dict(parse_qsl(parts.query))
        query.pop('start', None)
        query['t'] = str(start_ms // 1000)
        return urlunsplit(parts._replace(query=urlencode(query)))
    return url
