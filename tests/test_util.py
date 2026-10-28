import math

from pipeline.util import clip, num, rnd, safe_filename, strip_html, to_iso_date


def test_num_parses_common_formats():
    assert num("1,234.5") == 1234.5
    assert num("+12") == 12.0
    assert num(" -0.50 ") == -0.5
    assert num("<p style='color:red'>+</p>") is None
    assert num("--") is None and num("") is None and num(None) is None
    assert num(float("nan")) is None
    assert num("abc", default=0) == 0
    assert num(True) is None


def test_to_iso_date_variants():
    assert to_iso_date("20261027") == "2026-10-27"
    assert to_iso_date("2026-10-27") == "2026-10-27"
    assert to_iso_date("2026/10/27") == "2026-10-27"
    assert to_iso_date("1151027") == "2026-10-27"
    assert to_iso_date("115/10/27") == "2026-10-27"
    assert to_iso_date("20261340") == ""
    assert to_iso_date(None) == "" and to_iso_date("") == ""


def test_misc_helpers():
    assert strip_html("<b>a</b>b") == "ab"
    assert clip("abcdef", 3) == "abc" and clip(None, 3) == ""
    assert rnd(1234.5678) == 1234.57 and rnd(1.23456789) == 1.2346
    assert safe_filename("^TWII") == "_TWII" and safe_filename("GC=F") == "GC_F" and safe_filename("2330.TW") == "2330.TW"
    assert not math.isnan(rnd(1.0))
