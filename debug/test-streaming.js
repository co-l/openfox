#!/usr/bin/env node

const HOST = 'http://192.168.1.223:8000'
const MODEL = 'cyankiwi/MiniMax-M2.5-AWQ-4bit'

const tools = [
  {
    type: 'function',
    function: {
      name: 'echo',
      description: 'Echo back the input',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to echo' }
        },
        required: ['text']
      }
    }
  }
]

const prompt = 'Say hello using the echo tool with 200 words'

async function main() {
  console.log('=== Testing tool call streaming ===\n')

  const response = await fetch(`${HOST}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'user', content: prompt }
      ],
      tools,
      stream: true,
    }),
  })

  if (!response.ok) {
    console.error('Request failed:', response.status, await response.text())
    process.exit(1)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      if (data === '[DONE]') {
        console.log('\n=== DONE ===')
        return
      }

      try {

        let parsed = JSON.parse(data)
        console.log(JSON.stringify(parsed.choices[0].delta))
      } catch (e) {
        // skip
        console.log('?', data)
      }
    }
  }
}

main().catch(console.error)