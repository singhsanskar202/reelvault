# ReelVault — Pipeline Testing Findings
**Date:** 2026-05-21

## What We Tested

End-to-end pipeline validation before building: Instagram CDN URL → Groq Whisper → Groq Llama → formatted shayari.

---

## Results

### 1. Groq Whisper `url` param — WORKS ✅
Groq can fetch Instagram CDN URLs directly. No file download needed on Vercel.
- Model: `whisper-large-v3` (use this, not `turbo` — better accuracy for Hindi/Urdu)
- Do NOT pass `language: 'hi'` — Whisper badly transliterates Urdu words into Devanagari
- Let it auto-detect → it outputs Urdu script, which is correct

### 2. Instagram CDN URLs — ACCESSIBLE ✅
Tested with a real reel: `https://www.instagram.com/p/DYH57XWpqKl/`  
Groq fetched the CDN URL without any extra headers or auth.  
CDN URLs expire in hours — process immediately on webhook receipt.

### 3. Shayari transcription accuracy — GOOD ✅
Raw Urdu output from `whisper-large-v3`:
```
دن کچھ ایسے گزارتا ہے کوئی جیسے احسان اتارتا ہے کوئی
دل میں کچھ یوں سنبھالتا ہوں غم جیسے زیور سنبھالتا ہے کوئی
آئینہ دیکھ کر تسلی ہوئی ہم کو اس گھر میں جانتا ہے کوئی
```

### 4. Segment detection — PERFECT ✅
`response_format: 'verbose_json'` with `timestamp_granularities: ['segment']` returns exactly one segment per sher (couplet). Natural audio pauses = natural shayari line breaks.

### 5. Urdu → Hindi conversion — GOOD ✅
Llama 3.3 70B correctly converts Urdu to Hindi Devanagari.  
Final output:
```
दिन कुछ ऐसे गुजारता है कोई
जैसे एहसान उतारता है कोई

दिल में कुछ यूँ सम्भालता हूँ ग़म
जैसे ज़ेवर सम्भालता है कोई

आइना देख कर तसल्ली हुई
हम को इस घर में जानता है कोई
```

---

## Decisions for Implementation

| Decision | Choice | Reason |
|----------|--------|--------|
| Whisper model | `whisper-large-v3` | Better accuracy than turbo for Urdu/Hindi |
| Language param | None (auto-detect) | Forcing `hi` corrupts Urdu word transliteration |
| Transcription format | `verbose_json` + segments | Gives sher-level segmentation for free |
| Line splitting | Midpoint by word count | Segments = shers; midpoint splits misras approximately |
| Urdu→Hindi | Llama 3.3 70B | Handles the conversion well as part of extraction step |

---

## Known Limitations

- Word-level timestamps via `url` param return all zeros — can't use for precise misra detection
- Midpoint split is ~90% accurate for line breaks; occasional 1-word offset
- `groq-sdk` npm package is the correct Groq package (`groq` is a different/unrelated package)
