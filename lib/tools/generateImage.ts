'use client'

export type GeneratedImage = { url: string; revised_prompt?: string }

export async function generateImage(prompt: string, openaiApiKey: string): Promise<GeneratedImage> {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1024', response_format: 'url' }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenAI images API ${res.status}: ${text}`)
  }

  const data = await res.json() as { data?: Array<{ url?: string; revised_prompt?: string }> }
  const image = data.data?.[0]
  if (!image?.url) throw new Error('No image URL in response')
  return { url: image.url, revised_prompt: image.revised_prompt }
}
