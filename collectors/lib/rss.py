"""RSS/Atom/RDF フィードのパースと、記事の重複排除・時間窓・epoch変換（純粋）。"""
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import xml.etree.ElementTree as ET


def _local(tag):
    """名前空間を除いたローカル名（'{ns}item' -> 'item'）。"""
    return tag.rsplit("}", 1)[-1].lower()


def _parse_date(s):
    """RFC822（RSS）/ ISO8601（Atom/RDF）を ISO UTC 文字列に。失敗は None。"""
    if not s:
        return None
    s = s.strip()
    try:  # RFC822 "Wed, 18 Jun 2026 09:00:00 GMT"
        dt = parsedate_to_datetime(s)
    except (TypeError, ValueError, IndexError):
        dt = None
    if dt is None:
        try:  # ISO8601
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_feed(xml_text, source):
    """RSS2.0 / RDF(RSS1.0) / Atom から {title,url,published_iso,source} 配列（純粋）。"""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    out = []
    for el in root.iter():
        if _local(el.tag) not in ("item", "entry"):
            continue
        title = url = date = None
        for ch in el:
            name = _local(ch.tag)
            if name == "title" and title is None:
                title = (ch.text or "").strip()
            elif name == "link" and url is None:
                url = (ch.text or "").strip() or ch.attrib.get("href", "").strip()
            elif name in ("pubdate", "published", "date", "updated") and date is None:
                date = _parse_date(ch.text)
        if title and url:
            out.append({"title": title, "url": url, "published_iso": date, "source": source})
    return out
