# Independent final ColumnBridge QA

The complete original six-fixture matrix and the same three apply checks were rerun serially against the locked final core source. Core-source hashes matched before and after the runs. The exact file manifest and aggregate SHA256 are in `core-source-sha256.json`.

All six cases passed: five expected successful reports and explicit duplicate-header rejection. Normal aliases suggested the five correct targets; competing email columns both required review; unrelated headers all abstained. The final collision fix was verified in both quoted-data and formula-data cases: Notes remains under review and the valid quantity column is suggested.

All generated review files remained unapproved; all original input hashes stayed unchanged. Independent Python CSV parsing verified quoted commas, escaped quotes, Unicode, embedded LF/CRLF, BOM and empty-cell preservation after approved synthetic rename. Formula/HTML strings were preserved as data. Unapproved apply failed with no output.

Final cached inference was performed with Node fetch/http/https/net/tls denied and recorded zero network attempts. An earlier targeted empty-cache offline check explicitly failed without fallback or output; retained evidence is separate. This is Node API instrumentation, not OS packet capture.

These are synthetic acceptance cases, not customer accuracy claims. Recorded timings are local observations. Formula strings are not neutralized for spreadsheets. No customer, sale, prize or general security certification is claimed. All subprocesses exited before packaging.
