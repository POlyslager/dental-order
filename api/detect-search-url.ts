import type { VercelRequest, VercelResponse } from '@vercel/node'
import { HTML_HEADERS } from './find-alternatives'

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

    // Find a <form method="get"> with a text/search input that has a name attribute
    for (const formMatch of html.matchAll(/<form\b[^>]*\bmethod=["']get["'][^>]*>([\s\S]*?)<\/form>/gi)) {
      const formTag = formMatch[0]
      const actionM = formTag.match(/\baction=["']([^"']*?)["']/i)
      if (!actionM) continue

      const inputM = formTag.match(/<input\b[^>]*\btype=["'](?:text|search)["'][^>]*\bname=["']([^"']+)["']/i)
             ?? formTag.match(/<input\b[^>]*\bname=["']([^"']+)["'][^>]*\btype=["'](?:text|search)["']/i)
      if (!inputM) continue

      const action = actionM[1].trim()
      const paramName = inputM[1]

      // Skip obviously wrong actions (anchors, javascript, empty)
      if (!action || action.startsWith('#') || action.startsWith('javascript')) continue

      const base = finalUrl ?? baseUrl
      const fullAction = action.startsWith('http') ? action : new URL(action, base).href
      const sep = fullAction.includes('?') ? '&' : '?'
      const detected = `${fullAction}${sep}${paramName}={q}`

      return res.status(200).json({ detected })
    }

    return res.status(200).json({ detected: null, error: 'Kein Suchformular gefunden' })
  } catch (e) {
    return res.status(200).json({ detected: null, error: String(e) })
  }
}
