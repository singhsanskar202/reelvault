// Test: Does Groq Whisper accept a `url` param directly?
// Run: GROQ_API_KEY=your_key node test-groq-url.mjs

import Groq from 'groq-sdk'

const key = process.env.GROQ_API_KEY
if (!key) {
  console.error('Set GROQ_API_KEY env var first')
  process.exit(1)
}

const groq = new Groq({ apiKey: key })

// Public audio from Wikipedia (very reliable, public domain)
const TEST_URL = 'https://upload.wikimedia.org/wikipedia/commons/4/4e/BWV_543-fugue.ogg'

console.log('Testing Groq Whisper with url param...')
console.log('URL:', TEST_URL)

try {
  const result = await groq.audio.transcriptions.create({
    model: 'whisper-large-v3-turbo',
    url: TEST_URL,
    response_format: 'json',
  })
  console.log('\n✅ SUCCESS — url param works!')
  console.log('Transcript:', result.text)
} catch (err) {
  console.log('\n❌ FAILED — url param does NOT work')
  console.log('Error:', err.message)
  if (err.status) console.log('Status:', err.status)
  if (err.error) console.log('Detail:', JSON.stringify(err.error, null, 2))
  console.log('Full error:', JSON.stringify(err, null, 2))
  console.log('\n→ Architecture assumption broken. Need file upload fallback.')
}
