import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("overlap", Path(__file__).with_name("audit-source-overlap.py"))
overlap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(overlap)


class SourceOverlapTests(unittest.TestCase):
    def test_renamed_source_is_found_after_small_edits(self):
        source = "\n".join(f"export const resource_{i} = 'long-enough-contract-value-{i}';" for i in range(12))
        result = overlap.audit({"old.ts": source.encode()}, {"new.ts": ("// new header\n" + source + "\n// footer").encode()})
        self.assertEqual(result["same_path_blocks"], [])
        self.assertEqual(len(result["cross_path_blocks"]), 1)
        self.assertEqual(result["cross_path_blocks"][0]["matched_lines"], 12)
        self.assertEqual(result["cross_path_blocks"][0]["baseline_file"], "old.ts")

    def test_short_lines_can_form_a_long_qualifying_block(self):
        source = "\n".join(f"value{i}," for i in range(40))
        result = overlap.audit({"old.ts": source.encode()}, {"new.ts": ("// extra\n" + source).encode()})
        self.assertEqual(result["cross_path_blocks"][0]["matched_lines"], 40)

    def test_identical_renamed_binary_resources_are_reported(self):
        result = overlap.audit({"old.svg": b"\x00\xffsame-resource"}, {"renamed.svg": b"\x00\xffsame-resource"})
        self.assertEqual(result["exact"][0]["baseline_files"], ["old.svg"])
        self.assertEqual(result["cross_path_blocks"], [])

    def test_whitespace_normalization_preserves_same_path_thresholds(self):
        source = "\n".join(f"const contract_{i} = 'serialized-value-{i}';" for i in range(8))
        result = overlap.audit({"same.ts": source.encode()}, {"same.ts": ("\n".join("    " + line for line in source.splitlines())).encode()})
        self.assertEqual(result["same_path_blocks"][0]["matched_lines"], 8)
        self.assertEqual(result["exact"], [])
        short = overlap.audit({"old.ts": b"a\nb\nc\nd\ne"}, {"new.ts": b"a\nb\nc\nd\ne"})
        self.assertEqual(short["cross_path_blocks"], [])


if __name__ == "__main__":
    unittest.main()
