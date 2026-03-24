import type { VercelRequest, VercelResponse } from '@vercel/node'

const HTML_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { baseUrl } = req.body as { baseUrl?: string }
  if (!baseUrl?.trim()) return res.status(400).json({ error: 'baseUrl required' })

  try {
    const response = await fetch(baseUrl.trim(), {
      headers: HTML_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return res.status(200).json({ detected: null, error: `HTTP ${response.status}` })

    const html = await response.text()
    const finalUrl = response.url

    for (const formMatch of html.matchAll(/<form\b[^>]*\bmethod=["']get["'][^>]*>([\s\S]*?)<\/form>/gi)) {
      const formTag = formMatch[0]
      const actionM = formTag.match(/\baction=["']([^"']*?)["']/i)
      if (!actionM) continue

      const inputM = formTag.match(/<input\b[^>]*\btype=["'](?:text|search)["'][^>]*\bname=["']([^"']+)["']/i)
             ?? formTag.match(/<input\b[^>]*\bname=["']([^"']+)["'][^>]*\btype=["'](?:text|search)["']/i)
      if (!inputM) continue

      const action = actionM[1].trim()
      const paramName = inputM[1]
      if (!action || action.startsWith('#') || action.startsWith('javascript')) continue

      const fullAction = action.startsWith('http') ? action : new URL(action, finalUrl ?? baseUrl).href
      const sep = fullAction.includes('?') ? '&' : '?'
      return res.status(200).json({ detected: `${fullAction}${sep}${paramName}={q}` })
    }

    return res.status(200).json({ detected: null, error: 'Kein Suchformular gefunden' })
  } catch (e) {
    return res.status(200).json({ detected: null, error: String(e) })
  }
}
