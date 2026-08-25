# mailman - Overview

Public document. Behaviour only.

## What this is

A document intake pipeline. A supplier invoice arrives as a PDF, a scan or a spreadsheet.
mailman reads it, pulls out the fields that matter, checks the result against rules that
were written down in advance, and either files the record or puts it in front of a person
to fix. What a person fixes is recorded.

The output is a structured record in a database. The input is whatever the sender happened
to send.

## The problem it exists for

Systems that exchange structured data work when both ends already agreed on a format. That
agreement is the expensive part, and most senders never make it. A supplier emails a PDF. A
partner sends a scan of a bill of lading. A customer attaches a spreadsheet with the columns
in the wrong order. All of it lands on a person, who retypes it.

mailman is the layer in front of the format agreement: it takes documents that were never
going to conform and produces records that do.

## What it does

| Capability | Description |
| --- | --- |
| Accept a document | PDF or image, submitted by upload. Spreadsheets and scans without a text layer come later, and until then the system says it does not handle them rather than half-handling them |
| Catch a duplicate | An invoice number already recorded against that vendor is caught before a second record is filed. Duplicate invoices are the expensive mistake in this domain |
| Prepare it for reading | Pull the text layer out of a PDF and keep it, so a bad result can be traced to a bad read |
| Extract | Ask a language model for the fields as structured data: invoice number, dates, party names, currency, line items, totals |
| Validate | Check the extraction against business rules. Do the line items sum to the stated total. Is the date plausible. Is this vendor known. Has this invoice number been seen before |
| Decide | Pass it through, or send it to review. The rule that makes this decision is configuration, not an opinion buried in code |
| Review | A queue where a person sees the document beside the extracted fields, corrects what is wrong, and approves |
| Record corrections | Every field a person changed, from what to what, by whom and when |
| Store | Approved records land in PostgreSQL and are available over an API |
| Report on itself | Counts by status and the auto-approval rate, over the API. The system can say how much work it is actually saving |
| Measure | An evaluation harness runs the pipeline against a labelled document set and reports field-level accuracy |

## What "confidence" means here

Not what the model says about itself. Confidence here is composed from several signals,
ranked by how far they can be trusted:

1. A validation rule failed. The line items do not sum to the total. This is arithmetic and
   it is certain.
2. A required field came back empty.
3. A field came back in a shape that is not a date, a number or a currency.
4. The model said it was unsure.

The last one contributes least, and it can send a document to review but can never rescue
one. A model that is confidently wrong is the failure mode this system is built to survive,
and a system that trusted the model's self-assessment would be defenceless against exactly
that.

Where the threshold sits is a real decision with a cost on both sides: too low and bad
records reach the database, too high and a person reviews everything. It gets set from a
measurement, and the reasoning gets written down.

## How it is used

1. A document is uploaded.
2. The pipeline runs in the background. Most documents finish without a person.
3. Anything that failed a rule or came back doubtful appears in the review queue.
4. A reviewer opens it, sees the document next to the fields, fixes what is wrong, approves.
5. The record is in the database. The correction is in the record of corrections.
6. Periodically, the evaluation harness is run against the labelled document set to find out
   whether a change to the prompt, the model or the pipeline made extraction better or
   worse.

## What it does not do

- It does not approve payments, post to a ledger, or do anything with the record once it is
  stored. It produces records; something else consumes them.
- It does not learn from corrections automatically. Corrections are recorded so a person can
  use them; nothing retrains itself.
- It does not guess when it does not know. An empty field that goes to review is a better
  outcome than a plausible invented one.
- It does not handle every document type. Invoices first. The shape is meant to generalise;
  the claim that it has generalised will not be made until a second type is actually
  running.
- It is not an OCR engine or a PDF library. It uses those.

## The documents it runs on

Synthetic and public sample documents only. Generated invoices, public sample bills of
lading, spreadsheets written for the purpose. No document from an employer or an employer's
client goes into this repository, into the label set, or through the pipeline. This is a
hard rule and it is not negotiable for the sake of a more realistic demonstration.

## Requirements to run it

Python, PostgreSQL, and credentials for a language model provider supplied through the
environment. It runs from a terminal on Windows. The review queue is served by the same
process that runs the API, so there is no separate front-end build step.
