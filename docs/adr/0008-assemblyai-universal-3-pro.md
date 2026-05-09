# 0008. AssemblyAI Universal-3 Pro as ASR vendor

Date: 2026-05-07
Status: Accepted

## Context

The pipeline needs an ASR vendor for selectboard meeting audio. Volume
is light (~48 hr/year per board at v1). Quality requirements: diarized
output (the segmentation pipeline depends on speaker turn boundaries),
competitive WER on meeting-style audio, and a path to opt out of model
training on customer audio (newsroom product, source confidentiality).
Pricing has to fit a tight fixed budget where ASR is one of three
variable lines.

## Considered options

- **AssemblyAI Universal-3 Pro** — $0.21/hr, diarization included,
  Earnings-21 WER ~8.8%, opt-out of training available by email.
- **AssemblyAI Universal-2** — $0.15/hr, same vendor; rejected for
  weaker accent and rare-word handling.
- **Deepgram Nova-3** — competitive WER, comparable price tier;
  diarization quality on long-form meeting audio less proven.
- **Rev.ai** — strong WER but priced at the human-transcription tier
  the project can't sustain.
- **AWS Transcribe** — ties the project to AWS for one service; pricing
  and DX no better than the pure-play vendors.
- **OpenAI Whisper API** — no diarization, would require a second
  diarization pass.

## Decision

Use AssemblyAI Universal-3 Pro. The $0.06/hr premium over Universal-2
is acceptable for the accent, rare-word, and alphanumeric accuracy
delta. Send opt-out request to `data-opt-out@assemblyai.com` from the
account-tied address before the first ASR submission of any kind.

## Consequences

- ~$10/year ASR variable cost at v1 volume (~48 hr/year, single board).
- Diarized output unblocks the segmentation pipeline without a second
  vendor.
- AssemblyAI ToS §4.3 grants a training license with plan-conditional
  opt-out; opt-out confirmation must land before the first submission
  including dev/testing.
- Revisit: if WER on Maine accents proves materially worse than
  benchmarks suggest after a smoke run.
