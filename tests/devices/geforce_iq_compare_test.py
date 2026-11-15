#!/usr/bin/env python3
import struct
import tempfile
import unittest
from pathlib import Path
from geforce_iq_compare import compare


def write_bitmap(path, rows):
    height, width = len(rows), len(rows[0])
    pitch = (width * 3 + 3) & ~3
    pixels = b''.join(b''.join(bytes(reversed(rgb)) for rgb in row)
                      + bytes(pitch - width * 3) for row in reversed(rows))
    path.write_bytes(struct.pack('<2sIHHI', b'BM', 54 + len(pixels), 0, 0, 54)
                     + struct.pack('<IiiHHIIiiII', 40, width, height, 1, 24, 0,
                                   len(pixels), 0, 0, 0, 0) + pixels)


class MetadataRegionTest(unittest.TestCase):
    def test_bottom_metadata_keeps_top_scene_and_both_bounds(self):
        with tempfile.TemporaryDirectory() as directory:
            native, reference = Path(directory) / 'a.bmp', Path(directory) / 'b.bmp'
            rows = [[(0, 0, 0)] * 3 for _ in range(4)]
            write_bitmap(native, rows)
            rows[3] = [(255, 255, 255)] * 3
            write_bitmap(reference, rows)
            self.assertEqual(compare(native, reference, 0, 1)['max_channel_error'], 0)
            self.assertGreater(compare(native, reference, 1, 0)['max_channel_error'], 0)
            rows[1][1] = (12, 6, 0)
            write_bitmap(reference, rows)
            result = compare(native, reference, 1, 1)
            self.assertEqual(result['pixels'], 6)
            self.assertEqual(result['different_pixels'], 1)
            self.assertEqual(result['mean_absolute_rgb_error'], 1)
            self.assertEqual(result['max_channel_error'], 12)
            self.assertEqual((result['roi_y'], result['roi_height']), (1, 2))
            for top, bottom in [(0, 4), (2, 2), (-1, 0), (0, -1)]:
                with self.assertRaises(ValueError):
                    compare(native, reference, top, bottom)


if __name__ == '__main__':
    unittest.main()
