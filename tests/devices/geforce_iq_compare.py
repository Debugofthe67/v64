#!/usr/bin/env python3
"""Compare unchanged native/proxy 3DMark IQ BMPs; metrics are not a pass gate.

Example: geforce_iq_compare.py native-dir proxy-dir --native-suffix NV01A
         --reference-suffix S6MK01 --cases 4 --output comparison.json
Metadata placement depends on the original benchmark. Specify the matching
top or bottom exclusion explicitly; 03/05 overlays are at the bottom.
"""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import struct


def bitmap(path):
    data = path.read_bytes()
    if len(data) < 54 or data[:2] != b"BM":
        raise ValueError(f"{path}: missing BMP header")
    offset, header = struct.unpack_from("<II", data, 10)
    width, height, planes, bits, compression = struct.unpack_from("<iiHHI", data, 18)
    if header < 40 or offset < 14 + header or planes != 1 or bits != 24 or compression:
        raise ValueError(f"{path}: expected uncompressed 24-bit Windows BMP")
    if not 0 < width <= 16384 or not 0 < abs(height) <= 16384:
        raise ValueError(f"{path}: invalid dimensions")
    pitch = (width * 3 + 3) & ~3
    if offset + pitch * abs(height) > len(data):
        raise ValueError(f"{path}: truncated pixel rows")
    rows = [data[offset + y * pitch:offset + y * pitch + width * 3]
            for y in range(abs(height))]
    if height > 0:
        rows.reverse()
    return width, abs(height), rows, hashlib.sha256(data).hexdigest()


def compare(native, reference, exclude_top=64, exclude_bottom=0):
    width, height, a, native_hash = bitmap(native)
    rw, rh, b, reference_hash = bitmap(reference)
    if ((width, height) != (rw, rh) or exclude_top < 0 or exclude_bottom < 0
            or exclude_top + exclude_bottom >= height):
        raise ValueError("IQ dimensions or metadata exclusion do not match")
    histogram = Counter()
    absolute = [0, 0, 0]
    signed = [0, 0, 0]
    different = 0
    bottom = height - exclude_bottom
    for left, right in zip(a[exclude_top:bottom], b[exclude_top:bottom]):
        for x in range(0, width * 3, 3):
            delta = [left[x + c] - right[x + c] for c in range(3)]
            peak = max(map(abs, delta))
            histogram[peak] += 1
            different += peak != 0
            for c in range(3):
                absolute[c] += abs(delta[c])
                signed[c] += delta[c]
    pixels = width * (height - exclude_top - exclude_bottom)
    cumulative = 0
    quantiles = {}
    for error, count in sorted(histogram.items()):
        cumulative += count
        for percent in [50, 90, 95, 99, 99.9]:
            if str(percent) not in quantiles and cumulative >= pixels * percent / 100:
                quantiles[str(percent)] = error
    return {
        "native": {"file": str(native), "sha256": native_hash},
        "reference": {"file": str(reference), "sha256": reference_hash},
        "width": width, "height": height, "roi_y": exclude_top,
        "roi_height": height - exclude_top - exclude_bottom,
        "pixels": pixels, "different_pixels": different,
        "exact_pixel_percent": 100 * (1 - different / pixels),
        "mean_absolute_rgb_error": sum(absolute) / (pixels * 3),
        "mean_signed_rgb_error": [signed[c] / pixels for c in [2, 1, 0]],
        "max_channel_error": max(histogram),
        "pixel_max_channel_error_percentiles": quantiles,
        "pixel_max_channel_error_histogram": dict(sorted(histogram.items())),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("native", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("--native-suffix", required=True)
    parser.add_argument("--reference-suffix", required=True)
    parser.add_argument("--cases", required=True, type=int)
    parser.add_argument("--exclude-top", default=64, type=int)
    parser.add_argument("--exclude-bottom", default=0, type=int)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if not 1 <= args.cases <= 100:
        parser.error("cases must be between 1 and 100")
    results = []
    for case in range(1, args.cases + 1):
        result = compare(
            args.native / f"Quality_IQ{case:02}I_{args.native_suffix}.bmp",
            args.reference / f"Quality_IQ{case:02}I_{args.reference_suffix}.bmp",
            args.exclude_top, args.exclude_bottom)
        results.append({"case": case, **result})
    args.output.write_text(json.dumps({
        "scope": "Unchanged original IQ images; metadata rows excluded. No acceptance threshold is inferred.",
        "images": results,
    }, indent=2) + "\n")
    for result in results:
        print(f"IQ{result['case']:02}: {result['different_pixels']}/{result['pixels']} differing pixels, "
              f"MAD {result['mean_absolute_rgb_error']:.6f}, max {result['max_channel_error']}")


if __name__ == "__main__":
    main()
