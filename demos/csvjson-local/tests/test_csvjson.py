import csv
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("csvjson", ROOT / "csvjson.py")
csvjson = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(csvjson)


class ConversionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix=".test-", dir=ROOT)
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.source = self.directory / "input.csv"
        self.output = self.directory / "output.json"

    def write_csv(self, headers, rows, delimiter=",", quotechar='"', bom=False):
        stream = io.StringIO(newline="")
        writer = csv.writer(stream, delimiter=delimiter, quotechar=quotechar, lineterminator="\r\n")
        writer.writerow(headers)
        writer.writerows(rows)
        data = (("\ufeff" if bom else "") + stream.getvalue()).encode("utf-8")
        self.source.write_bytes(data)
        return data

    def assert_rejected_cleanly(self, data, expected_error, **kwargs):
        self.source.write_bytes(data)
        original_hash = hashlib.sha256(data).hexdigest()
        with self.assertRaisesRegex(csvjson.ConversionError, expected_error):
            csvjson.convert_csv(self.source, self.output, **kwargs)
        self.assertFalse(self.output.exists())
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(), original_hash)
        self.assertEqual(sorted(x.name for x in self.directory.iterdir()), ["input.csv"])

    def test_rfc_quotes_embedded_lines_unicode_bom_and_string_values(self):
        headers = ["id", "name", "notes", "empty", "amount"]
        rows = [["0007", "Mira, Chen", 'She said "hi"\r\nSecond line\n第三行', "", "01.20"],
                ["0008", "Leon", "\\path\\file\tcontrol\x01", "", "null"]]
        original = self.write_csv(headers, rows, bom=True)
        summary = csvjson.convert_csv(self.source, self.output)
        with self.output.open(encoding="utf-8") as stream:
            parsed = json.load(stream)
        self.assertEqual(parsed, [dict(zip(headers, row)) for row in rows])
        self.assertEqual(self.source.read_bytes(), original)
        self.assertEqual(summary["rows"], 2)
        self.assertEqual(summary["input_bytes"], len(original))
        self.assertEqual(summary["input_sha256"], hashlib.sha256(original).hexdigest())
        self.assertEqual(summary["output_bytes"], self.output.stat().st_size)
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o600)
        self.assertTrue(all(isinstance(value, str) for row in parsed for value in row.values()))

    def test_semicolon_tab_pipe_and_custom_quote(self):
        for number, delimiter in enumerate([";", "\t", "|"]):
            with self.subTest(delimiter=delimiter):
                self.output = self.directory / ("output%d.json" % number)
                rows = [["v" + delimiter + "inside", "It's quoted\nnew line"]]
                self.write_csv(["a", "b"], rows, delimiter=delimiter, quotechar="'")
                csvjson.convert_csv(self.source, self.output, delimiter=delimiter, quotechar="'")
                self.assertEqual(json.loads(self.output.read_text()), [{"a": rows[0][0], "b": rows[0][1]}])

    def test_header_only_produces_empty_array(self):
        self.source.write_text("id,name\r\n", encoding="utf-8")
        self.assertEqual(csvjson.convert_csv(self.source, self.output)["rows"], 0)
        self.assertEqual(json.loads(self.output.read_text()), [])

    def test_duplicate_and_empty_headers_fail(self):
        for payload in [b"a,a\n1,2\n", b"a,\n1,2\n", b"a,  \n1,2\n", b"\n", b""]:
            with self.subTest(payload=payload):
                self.assert_rejected_cleanly(payload, "Duplicate|Empty|empty")

    def test_ragged_or_unterminated_records_fail_after_partial_temp_write(self):
        for payload in [b"a,b\n1,2\n3\n", b"a,b\n1,2,3\n", b'a,b\n"unterminated,2\n', b"a,b\n\n"]:
            with self.subTest(payload=payload):
                self.assert_rejected_cleanly(payload, "record|Invalid CSV")

    def test_invalid_utf8_fails_without_replacement_characters(self):
        self.assert_rejected_cleanly(b"a\n\xff\n", "UTF-8")

    def test_nul_rejected_in_quoted_field_and_header_on_every_python_version(self):
        for payload in [b'a\n"left\x00right"\n', b'"head\x00er"\nx\n']:
            with self.subTest(payload=payload):
                self.assert_rejected_cleanly(payload, "NUL bytes")

    def test_input_byte_and_field_limits(self):
        self.assert_rejected_cleanly(b"a\n12345\n", "max-bytes", max_bytes=4)
        self.assert_rejected_cleanly(b"a\n12345\n", "field larger", max_field_chars=4)

    def test_output_amplification_limit_cleans_partial_file(self):
        self.assert_rejected_cleanly(b"a_long_header\nx\ny\n", "max-output-bytes", max_output_bytes=20)

    def test_stream_limit_catches_growth_beyond_initial_stat(self):
        reader = csvjson.LimitedReader(io.BytesIO(b"abcdef"), 5)
        buffer = bytearray(4)
        self.assertEqual(reader.readinto(buffer), 4)
        with self.assertRaisesRegex(csvjson.ConversionError, "max-bytes"):
            reader.readinto(buffer)

    def test_field_limit_restored_on_failure(self):
        before = csv.field_size_limit()
        self.assert_rejected_cleanly(b"a\n12345\n", "field larger", max_field_chars=2)
        self.assertEqual(csv.field_size_limit(), before)

    def test_existing_regular_symlink_dangling_link_and_hardlink_outputs_refused(self):
        self.source.write_bytes(b"a\n001\n")
        original = self.source.read_bytes()
        targets = [self.directory / "ordinary.json", self.directory / "symlink.json",
                   self.directory / "dangling.json", self.directory / "hardlink.json"]
        targets[0].write_bytes(b"KEEP")
        targets[1].symlink_to(self.source)
        targets[2].symlink_to(self.directory / "missing")
        os.link(self.source, targets[3])
        for target in targets + [self.source]:
            with self.subTest(target=target.name):
                with self.assertRaisesRegex(csvjson.ConversionError, "already exists"):
                    csvjson.convert_csv(self.source, target)
                self.assertEqual(self.source.read_bytes(), original)
        self.assertEqual(targets[0].read_bytes(), b"KEEP")
        self.assertTrue(targets[1].is_symlink())
        self.assertTrue(targets[2].is_symlink())
        self.assertEqual(os.stat(self.source).st_ino, os.stat(targets[3]).st_ino)

    def test_racing_output_writer_is_not_overwritten(self):
        self.source.write_bytes(b"a\n001\n")
        actual_link = os.link
        def late_writer(source, target, **kwargs):
            Path(target).write_bytes(b"WINNER")
            return actual_link(source, target, **kwargs)
        with mock.patch.object(csvjson.os, "link", side_effect=late_writer):
            with self.assertRaisesRegex(csvjson.ConversionError, "appeared"):
                csvjson.convert_csv(self.source, self.output)
        self.assertEqual(self.output.read_bytes(), b"WINNER")
        self.assertEqual(self.source.read_bytes(), b"a\n001\n")
        self.assertFalse(any(p.name.endswith(".tmp") for p in self.directory.iterdir()))

    def test_formula_html_backslash_values_are_only_json_strings(self):
        rows = [["=SUM(1,2)", '<script>alert("x")</script>', r"C:\\demo\\file"]]
        self.write_csv(["formula", "html", "path"], rows)
        csvjson.convert_csv(self.source, self.output)
        self.assertEqual(list(json.loads(self.output.read_text())[0].values()), rows[0])

    def test_cli_named_delimiter_summary_and_no_stdout_data(self):
        original = self.write_csv(["a", "b"], [["001", "secret-synthetic-cell"]], delimiter="\t")
        result = subprocess.run([sys.executable, str(ROOT / "csvjson.py"), str(self.source), "--output", str(self.output), "--delimiter", "tab"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertEqual(summary["delimiter"], "\t")
        self.assertNotIn("secret-synthetic-cell", result.stdout)
        self.assertEqual(self.source.read_bytes(), original)
        self.assertEqual(json.loads(self.output.read_text()), [{"a": "001", "b": "secret-synthetic-cell"}])

    def test_cli_invalid_options_fail_without_output(self):
        self.source.write_bytes(b"a\nx\n")
        for options in [["--delimiter", "ab"], ["--quotechar", ","], ["--max-bytes", "0"]]:
            result = subprocess.run([sys.executable, str(ROOT / "csvjson.py"), str(self.source), "--output", str(self.output)] + options, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
