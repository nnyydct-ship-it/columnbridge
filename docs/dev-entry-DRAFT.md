*DRAFT — not submitted. Actual human entrant eligibility and required consent remain unconfirmed.*

*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 2: Side Hustle](https://dev.to/challenges/hacktoberfest-week2-2026-10-12).*

## What I Built

A CSV import can be syntactically perfect and still put the wrong information in the wrong field. `billing address` and `shipping address` are both close to `address`. Picking the more similar one does not answer the business question.

ColumnBridge is a small local tool for people who repeatedly import contact lists or customer exports. It uses an open-weight sentence-embedding model to propose column mappings, then stops for a review before it renames anything. It does not clean row values, guess missing facts, or merge two columns.

The intended paid use is a bounded setup service: adapt an import schema, check a customer's representative export locally, and hand over a reusable review workflow. That is a business hypothesis, not a sale. No customer, payment, or revenue is claimed for this project.

## Demo

[Watch the 36-second demo](https://raw.githubusercontent.com/nnyydct-ship-it/columnbridge/main/demo/columnbridge-demo.mp4)

The walkthrough is rendered from saved outputs of real local CLI runs. Its sample contacts are synthetic. The source CSV, schema, actual model output, and reproducible commands are included in the repository.

## Code

[Source code, examples, and evidence](https://github.com/nnyydct-ship-it/columnbridge)

The project was started on October 18, 2026 for this challenge. The application code is MIT licensed. Model weights and dependencies retain their own licenses.

## How I Built It

The runtime uses Transformers.js and the q8 ONNX version of `Xenova/all-MiniLM-L6-v2`, pinned to revision `751bff37182d3f1213fa05d7196b954e230abad9`. This is an Apache-2.0 model, running on the local CPU with two inference threads.

Source headers and target field descriptions become 384-dimensional embeddings. The matcher ranks cosine similarity and shows the runner-up and margin. There is no hand-written table that secretly maps `cell phone` to `telephone`. The model makes that semantic proposal.

Similarity is not a calibrated probability. The default score and margin cutoffs are conservative review heuristics, not a measured accuracy guarantee. Low similarity, a narrow margin, or two source columns competing for one target force review. A collision is kept visible instead of quietly assigning one column its second-best field.

The first operation creates a report plus a review template with `approved: false`. Applying a reviewed plan is a separate command. It checks the source headers, requires an explicit approval, rejects duplicate output names, and writes a new CSV. Row values stay unchanged.

The demonstration has a useful failure. Both address columns propose `address`; both are flagged `target_collision`. The tool cannot know which address a particular customer means. That decision belongs in the review, not inside a confidence score.

The finished build passed 19 deterministic tests and a separate black-box check of six synthetic CSV fixtures. Three apply checks verified refusal without approval and logical cell-value preservation after approval. A warm-cache run completed with Node fetch/HTTP/HTTPS/net/TLS calls denied; an empty-cache offline run failed without trying the network or writing a report. These checks cover the listed cases, not a general customer-accuracy or production-security guarantee.

One recorded first run, including the initial model download, took 8.58 seconds and used about 198 MiB maximum RSS on this Mac. A recorded warm-cache offline run took 0.35 seconds. These are single observations, not a latency benchmark or a service promise.

Only column names and schema descriptions enter the model. Row values do not. Initial setup downloads dependencies and model files; after caching, `--offline` runs without remote model access. This is not the claim that the initial installation needs no network.

## Why Does Open Innovation Matter?

The open model is the matching engine, rather than a coding assistant used only while building the product. It can be pinned, cached, inspected, and run on a small laptop without purchasing inference calls. The same exported schema can be used repeatedly without sending client tables to a hosted model.

A fixed model is also useful when a proposal looks wrong. The repository contains the exact model revision and input headers, so another person can reproduce the same ambiguity instead of relying on an unexplained hosted response.

## Limits and Next Steps

This prototype supports UTF-8 comma-delimited files with unique headers and a bounded schema. It does not validate whether the values satisfy a target database's business rules. It can be wrong on abbreviations, domain-specific names, and languages outside the demonstration. A reviewer must inspect every suggested mapping.

Formula-looking cells are preserved as data, not sanitised; opening the result in spreadsheet software has that software's usual formula behaviour. No sample data is executed by ColumnBridge.

The next useful test is a real user's import, performed with their permission and an agreed schema. Until that happens, the evidence is a working prototype and synthetic tests, not product-market fit.

## Build Disclosure

EvidenceHarbor, an AI assistant working for its operator, generated this project and draft. A separate AI agent prepared black-box fixtures before inspecting the implementation. All reported tests must be backed by the saved runs. Raw assistant conversations, private instructions, credentials, and personal files are excluded.
