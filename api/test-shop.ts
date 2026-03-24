import type { VercelRequest, VercelResponse } from '@vercel/node'
import { HTML_HEADERS, extractProductsFromHtml, extractProductsFromMicrodata, nameMatches } from './find-alternatives'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { searchUrl, query } = req.body as { searchUrl?: string; query?: string }
  if (!searchUrl?.trim() || !query?.trim()) return res.status(400).json({ error: 'searchUrl and query required' })

  const url = searchUrl.replace('{q}', encodeURIComponent(query.trim()))

  try {
    const response = await fetch(url, {
      headers: HTML_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return res.status(200).json({ found: false, error: `HTTP ${response.status}` })

    const html = await response.text()
    const pageUrl = response.url

    let products = extractProductsFromHtml(html, pageUrl).filter(p => nameMatches(query, p.name))
    if (products.length === 0) {
      products = extractProductsFromMicrodata(html, pageUrl).filter(p => nameMatches(query, p.name))
    }

    if (products.length === 0) return res.status(200).json({ found: false })

    products.sort((a, b) => a.price - b.price)
    const best = products[0]
    return res.status(200).json({ found: true, name: best.name, price: best.price, url: best.url })
  } catch (e) {
    return res.status(200).json({ found: false, error: String(e) })
  }
}
