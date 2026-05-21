import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

const URL = 'https://instagram.fblr21-2.fna.fbcdn.net/o1/v/t2/f2/m86/AQMPtcHg-vq4XBx0vVML2XueahipezN9N4ArnuFkiEJlZchrpAtGRYlvi56fkppKfzA7QYDvJSZPIkN_NVH_tytdn692cHgtEQbF7_I.mp4?_nc_cat=107&_nc_oc=AdoTyby5pYgwFU_RHLB1MZePSWWjZIv_xJe5kCfidckmjk6k6R0q6GuDDFj4mBGBKLg&_nc_sid=5e9851&_nc_ht=instagram.fblr21-2.fna.fbcdn.net&_nc_ohc=q2pupWfk85MQ7kNvwEBtjq8&efg=eyJ2ZW5jb2RlX3RhZyI6Inhwdl9wcm9ncmVzc2l2ZS5JTlNUQUdSQU0uQ0xJUFMuQzMuOTYwLmRhc2hfYmFzZWxpbmVfMV92MSIsInhwdl9hc3NldF9pZCI6MTUzNDgyNDcyODA2NTYwNywiYXNzZXRfYWdlX2RheXMiOjExLCJ2aV91c2VjYXNlX2lkIjoxMDA5OSwiZHVyYXRpb25fcyI6MjIsInVybGdlbl9zb3VyY2UiOiJ3d3cifQ%3D%3D&ccb=17-1&vs=456ba85af26fb13&_nc_vs=HBksFQIYUmlnX3hwdl9yZWVsc19wZXJtYW5lbnRfc3JfcHJvZC82MDRDNkMyNDM0MkQxQTNGQzA2NjMxRTY1RjBCNzc4RV92aWRlb19kYXNoaW5pdC5tcDQVAALIARIAFQIYUWlnX3hwdl9wbGFjZW1lbnRfcGVybWFuZW50X3YyLzlBNDBDOTE1RDJGQkVDMkYyMUMwOTVERDRCRUM2OTlDX2F1ZGlvX2Rhc2hpbml0Lm1wNBUCAsgBEgAoABgAGwKIB3VzZV9vaWwBMRJwcm9ncmVzc2l2ZV9yZWNpcGUBMRUAACaO2aurx_q5BRUCKAJDMywXQDb3S8an754YEmRhc2hfYmFzZWxpbmVfMV92MREAdf4HZeadAQA&_nc_gid=SKN2g50Pu2cPUnDrzzkZGQ&_nc_zt=28&_nc_ss=7a22e&oh=00_Af7R8BxXL9Zq7BNp3EF-LT7e5h59kt9xeP7qCusJIjGLFw&oe=6A10FACC'

// Step 1: Transcribe with word-level timestamps
console.log('Transcribing...')
const transcription = await groq.audio.transcriptions.create({
  model: 'whisper-large-v3',
  url: URL,
  response_format: 'verbose_json',
  timestamp_granularities: ['segment', 'word'],
  prompt: 'This is Urdu/Hindi shayari poetry.',
})

// For each segment, find the largest gap between consecutive words — that's the misra break
const segmentsWithLines = transcription.segments.map(seg => {
  const words = transcription.words.filter(w => w.start >= seg.start && w.end <= seg.end + 0.1)
  if (words.length < 2) return { misra1: seg.text.trim(), misra2: '' }

  let maxGap = 0
  let breakIdx = 0
  for (let i = 0; i < words.length - 1; i++) {
    const gap = words[i + 1].start - words[i].end
    if (gap > maxGap) { maxGap = gap; breakIdx = i }
  }

  const misra1 = words.slice(0, breakIdx + 1).map(w => w.word).join(' ').trim()
  const misra2 = words.slice(breakIdx + 1).map(w => w.word).join(' ').trim()
  return { misra1, misra2, gap: maxGap.toFixed(2) }
})

console.log('Detected breaks:')
segmentsWithLines.forEach((s, i) => {
  console.log(`Sher ${i + 1} [gap=${s.gap}s]:`)
  console.log('  misra1:', s.misra1)
  console.log('  misra2:', s.misra2)
})
console.log('')

// Step 2: Convert to Hindi Devanagari
const completion = await groq.chat.completions.create({
  model: 'llama-3.3-70b-versatile',
  response_format: { type: 'json_object' },
  messages: [
    {
      role: 'system',
      content: [
        'You are an Urdu/Hindi poetry expert. Convert each Urdu misra to pure Hindi Devanagari.',
        'Rules:',
        '- Pure Devanagari only (U+0900-U+097F). Zero Urdu/Arabic chars.',
        '- Fix minor transcription errors using poetic context.',
        '- Key word mappings: koi=koi, ehsaan=ehsaan, zevar=zevar, aaina=aaina, tasalli=tasalli, gham=gam',
        'Input: array of shers, each with misra1 and misra2 in Urdu.',
        'Output JSON: { "shers": [ {"misra1": "hindi...", "misra2": "hindi..."}, ... ] }',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify(segmentsWithLines.map(s => ({ misra1: s.misra1, misra2: s.misra2 }))),
    },
  ],
  temperature: 0.1,
})

const { shers } = JSON.parse(completion.choices[0].message.content)

console.log('--- FINAL TRANSCRIPT ---')
shers.forEach((sher, i) => {
  console.log(sher.misra1)
  console.log(sher.misra2)
  if (i < shers.length - 1) console.log('')
})
