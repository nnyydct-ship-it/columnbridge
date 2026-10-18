# CSV → JSON: unaccepted proposal prototype

Original, local Python standard-library prototype. **This is not an accepted job, customer delivery, paid sale or verified income.** All examples use synthetic data; this demonstration does not submit or claim a bounty.

It implements one narrow interpretation of the public brief: the first CSV record supplies JSON object keys; each later record becomes an object in one JSON array. **All values remain strings.** No dates, prices, booleans, empty cells or leading-zero identifiers are guessed or coerced.

## Run

Requires Python 3.9+ on macOS/Linux. No pip packages, API keys or network requests.

```sh
python3 csvjson.py fixtures/contacts.csv --output contacts.json
python3 csvjson.py fixtures/semicolon.csv --output semicolon.json --delimiter semicolon
python3 csvjson.py fixtures/tabs.tsv --output tabs.json --delimiter tab
python3 csvjson.py fixtures/single-quotes.csv --output quoted.json --quotechar "'"
```

`--delimiter` accepts `comma`, `tab`, `semicolon`, `pipe`, `\t`, or a literal character. `--quotechar` accepts one character, default `"`; it must differ from the delimiter. Input is UTF-8, with or without an initial BOM. Delimiter detection and other encodings are deliberately outside this small prototype.

CSV quotes may contain delimiters and embedded LF/CRLF; doubled quotes are handled by Python's `csv.reader`. JSON escaping is delegated to `json.dump`, including quotes, backslashes and supported control characters. Binary NUL bytes are explicitly rejected, including inside quoted fields or headers, consistently across Python versions. This is a text-CSV converter, not a binary-data container. Header names are preserved exactly; exact duplicates and empty/whitespace-only names fail. Row widths must match the header. A blank physical record therefore fails rather than being silently discarded. A header-only CSV produces `[]`.

On success stdout contains one summary JSON object with counts, actual input byte count/hash and output byte count. Data is only written to `--output`. Errors go to stderr (exit 1); invalid CLI syntax exits 2. Error messages never print cell values.

## File handling

- Original input is opened read-only and is never rewritten.
- **Any existing output is refused**, including symlinks, dangling symlinks and hardlinks. Existing input/output names therefore cannot be used for in-place conversion.
- JSON is streamed into a random file in the destination directory with mode 0600. After parsing and fsync, an atomic no-clobber hard link publishes it. A racing output writer cannot be overwritten. The temporary name is removed on success or failure.
- This requires a local filesystem supporting hard links. An unsupported filesystem fails; there is no unsafe overwrite fallback. The parent directory must already exist.
- Default input limit: 100 MiB (`--max-bytes`); checked both before reading and against actual streamed bytes. Default per-field limit: 1,048,576 characters (`--max-field-chars`). Header limit: 10,000 columns. Rows are streamed rather than collecting the whole dataset in memory.
- Default JSON output limit: 200 MiB (`--max-output-bytes`), checked on actual UTF-8 bytes during serialization. This also bounds expansion from repeated long keys and JSON escaping; a limit failure removes partial output.
- Ordinary source size/mtime changes detected during reading abort before publication. This is not a concurrent-write locking protocol or an immutable filesystem snapshot.

File-byte formatting is not preserved in the **new JSON** file; logical cell values are. Spreadsheet formulas and HTML-like text are preserved as strings, not sanitized or executed. This script is not a spreadsheet safety filter.

## Verify

```sh
python3 -m unittest discover -s tests -v
```

Tests use synthetic local records only. They independently load JSON, verify original input bytes/hash, test delimiters/quotes/BOM/embedded lines/Unicode/empty strings, negative parsing paths, input/field bounds and no-clobber behavior including output links and a publication race. They do not use customer data.

The public brief has no detailed acceptance criteria, reward terms, payment network or deadline. JSON shape, string-only values, malformed-input policy, size limits, payment currency/network, fees and acceptance/payment timing still require agreement before a paid commitment. This local prototype does not resolve those business terms.

Code license: MIT; Python standard library remains under its own license.

Independent verification: 35 synthetic black-box cases passed with ordinary Python sockets disabled, in addition to 16 implementation unit tests. A separate static source review found no actionable issues within its stated scope. These checks do not establish customer acceptance or payment. See `qa/` for reproducible checks and results.
