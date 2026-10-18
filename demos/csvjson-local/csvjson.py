#!/usr/bin/env python3
"""Unaccepted proposal prototype: strict CSV -> JSON array, using Python stdlib only."""

import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile


DEFAULT_MAX_BYTES = 100 * 1024 * 1024
DEFAULT_MAX_FIELD_CHARS = 1024 * 1024
DEFAULT_MAX_OUTPUT_BYTES = 200 * 1024 * 1024
MAX_COLUMNS = 10000
DELIMITERS = {"comma": ",", "tab": "\t", "semicolon": ";", "pipe": "|", r"\t": "\t"}


class ConversionError(Exception):
    """A rejected conversion. No final output has been published."""


class LimitedReader(io.RawIOBase):
    """Count real bytes, including a file that grows after the initial stat."""

    def __init__(self, source, limit):
        super().__init__()
        self.source = source
        self.limit = limit
        self.count = 0
        self.digest = hashlib.sha256()

    def readable(self):
        return True

    def readinto(self, buffer):
        chunk = self.source.read(min(len(buffer), self.limit - self.count + 1))
        self.count += len(chunk)
        if self.count > self.limit:
            raise ConversionError("Input exceeds --max-bytes; nothing was published.")
        if b"\x00" in chunk:
            raise ConversionError("NUL bytes are not supported in UTF-8 text CSV.")
        self.digest.update(chunk)
        buffer[:len(chunk)] = chunk
        return len(chunk)


class BoundedWriter:
    """Bound JSON amplification from repeated long headers and escaped values."""

    def __init__(self, stream, limit):
        self.stream = stream
        self.limit = limit
        self.count = 0

    def write(self, text):
        size = len(text.encode("utf-8"))
        if self.count + size > self.limit:
            raise ConversionError("JSON exceeds --max-output-bytes; nothing was published.")
        result = self.stream.write(text)
        self.count += size
        return result


def _positive(value, label):
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ConversionError(label + " must be a positive integer.")


def _dialect(delimiter, quotechar):
    delimiter = DELIMITERS.get(delimiter, delimiter)
    for value, label in [(delimiter, "delimiter"), (quotechar, "quotechar")]:
        if not isinstance(value, str) or len(value) != 1 or value in "\r\n\0":
            raise ConversionError(label + " must be one non-newline, non-NUL character.")
    if delimiter == quotechar:
        raise ConversionError("delimiter and quotechar must differ.")
    return delimiter, quotechar


def convert_csv(input_path, output_path, delimiter=",", quotechar='"',
                max_bytes=DEFAULT_MAX_BYTES, max_field_chars=DEFAULT_MAX_FIELD_CHARS,
                max_output_bytes=DEFAULT_MAX_OUTPUT_BYTES):
    """Publish a new JSON array, or fail without replacing any existing output.

    Every cell is a string. No network, type inference, or spreadsheet sanitizing.
    File destinations must be on a filesystem supporting same-directory hard links.
    """
    _positive(max_bytes, "max_bytes")
    _positive(max_field_chars, "max_field_chars")
    _positive(max_output_bytes, "max_output_bytes")
    delimiter, quotechar = _dialect(delimiter, quotechar)
    source_path, destination = Path(input_path), Path(output_path)
    # lstat sees dangling symlinks too. The atomic link below also covers races.
    try:
        destination.lstat()
    except FileNotFoundError:
        pass
    else:
        raise ConversionError("Output already exists; choose a new output path.")
    if not destination.parent.is_dir():
        raise ConversionError("Output parent directory must already exist.")

    temporary = None
    previous_field_limit = csv.field_size_limit()
    try:
        csv.field_size_limit(max_field_chars)
        # Nonblocking open avoids hanging on a FIFO before we can reject it.
        with os.fdopen(os.open(source_path, os.O_RDONLY | os.O_NONBLOCK), "rb") as binary:
            before = os.fstat(binary.fileno())
            if not stat.S_ISREG(before.st_mode):
                raise ConversionError("Input must be a regular file.")
            if before.st_size > max_bytes:
                raise ConversionError("Input exceeds --max-bytes; nothing was published.")
            counted = LimitedReader(binary, max_bytes)
            # newline='' is required for csv's quoted LF/CRLF handling.
            with io.TextIOWrapper(io.BufferedReader(counted), encoding="utf-8-sig", errors="strict", newline="") as text:
                reader = csv.reader(text, delimiter=delimiter, quotechar=quotechar,
                                    doublequote=True, strict=True)
                try:
                    headers = next(reader)
                except StopIteration as error:
                    raise ConversionError("CSV is empty; a header record is required.") from error
                if not headers or any(not header.strip() for header in headers):
                    raise ConversionError("Empty or whitespace-only headers are not supported.")
                if len(headers) > MAX_COLUMNS:
                    raise ConversionError("Header exceeds the 10000-column prototype limit.")
                if len(set(headers)) != len(headers):
                    raise ConversionError("Duplicate header names are not supported.")

                fd, temporary = tempfile.mkstemp(prefix="." + destination.name + ".", suffix=".tmp", dir=str(destination.parent))
                rows = 0
                with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as output:
                    os.fchmod(output.fileno(), 0o600)
                    writer = BoundedWriter(output, max_output_bytes)
                    writer.write("[")
                    for record in reader:
                        if len(record) != len(headers):
                            raise ConversionError("CSV record ending at physical line %d has %d cells; expected %d." %
                                                  (reader.line_num, len(record), len(headers)))
                        writer.write(",\n" if rows else "\n")
                        writer.write("  ")
                        json.dump(dict(zip(headers, record)), writer, ensure_ascii=False, allow_nan=False)
                        rows += 1
                    writer.write("\n]\n" if rows else "]\n")
                    output.flush()
                    os.fsync(output.fileno())
                after = os.fstat(binary.fileno())
                if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                    raise ConversionError("Input changed during conversion; nothing was published.")
                summary = {"status": "ok", "rows": rows, "columns": len(headers),
                           "delimiter": delimiter, "encoding": "utf-8-sig", "values": "strings",
                           "input_bytes": counted.count, "input_sha256": counted.digest.hexdigest(),
                           "output_bytes": os.path.getsize(temporary)}
        # link is no-clobber atomically. A late output/symlink/hardlink wins; we fail.
        try:
            os.link(temporary, destination, follow_symlinks=False)
        except FileExistsError as error:
            raise ConversionError("Output appeared during conversion; nothing was overwritten.") from error
        return summary
    except (csv.Error, UnicodeError) as error:
        raise ConversionError("Invalid CSV or UTF-8 input: " + str(error)) from error
    finally:
        csv.field_size_limit(previous_field_limit)
        if temporary is not None:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass


def main(argv=None):
    parser = argparse.ArgumentParser(description="Unaccepted proposal prototype: CSV to a JSON array; never overwrite output.")
    parser.add_argument("input", help="UTF-8 CSV, optional initial BOM")
    parser.add_argument("--output", required=True, help="New output file; parent directory must exist")
    parser.add_argument("--delimiter", default="comma", help="comma, tab, semicolon, pipe, or one literal character")
    parser.add_argument("--quotechar", default='"', help="One quote character; default double quote")
    parser.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES, help="Maximum input bytes (default 100 MiB)")
    parser.add_argument("--max-field-chars", type=int, default=DEFAULT_MAX_FIELD_CHARS, help="Maximum CSV field characters (default 1 Mi)")
    parser.add_argument("--max-output-bytes", type=int, default=DEFAULT_MAX_OUTPUT_BYTES, help="Maximum JSON bytes (default 200 MiB)")
    args = parser.parse_args(argv)
    try:
        result = convert_csv(args.input, args.output, args.delimiter, args.quotechar, args.max_bytes, args.max_field_chars, args.max_output_bytes)
    except (ConversionError, OSError, OverflowError) as error:
        print("csvjson: " + str(error), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
