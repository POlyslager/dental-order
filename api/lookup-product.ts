import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { supplierUrl, query } = req.body as { supplierUrl?: string; query?: string }

  if (!query && !supplierUrl) return res.status(400).json({ found: false, error: 'query or supplierUrl required' })

  // Build candidate URLs to try
  const candidates: string[] = []

  if (supplierUrl) {
    try {
      const u = new URL(supplierUrl)
      // If the URL looks like a product page (has a path beyond root), try it directly
      if (u.pathname.length > 1) {
        candidates.push(supplierUrl)
      }
      // Also try common search endpoints on that domain
      if (query) {
        const q = encodeURIComponent(query)
        candidates.push(
          `${u.origin}/search?q=${q}`,
          `${u.origin}/suche?suchbegriff=${q}`,
          `${u.origin}/suche?query=${q}`,
          `${u.origin}/catalogsearch/result/?q=${q}`,   // Magento
          `${u.origin}/search?query=${q}`,
        )
      }
    } catch { /* invalid URL */ }
  }

  if (!candidates.length) return res.status(200).json({ found: false })

  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      })

      if (!response.ok) continue
      const html = await response.text()
      const finalUrl = response.url

      // ── 1. JSON-LD structured data ──────────────────────────────────────────
      const jsonLdBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
      for (const block of jsonLdBlocks) {
        try {
          const parsed = JSON.parse(block[1])
          const items = Array.isArray(parsed) ? parsed : [parsed]
          for (const item of items) {
            // Unwrap @graph if present
            const nodes = item['@graph'] ? item['@graph'] : [item]
            for (const node of nodes) {
              if (node['@type'] === 'Product' || node['@type']?.includes?.('Product')) {
                const price = node.offers?.price
                  ?? node.offers?.[0]?.price
                  ?? null
                return res.status(200).json({
                  found: true,
                  name: node.name ?? null,
                  description: node.description ?? null,
                  sku: node.sku ?? node.mpn ?? null,
                  brand: node.brand?.name ?? null,
                  price: price != null ? parseFloat(String(price)) || null : null,
                  productUrl: finalUrl,
                })
              }
            }
          }
        } catch { /* malformed JSON-LD, continue */ }
      }

      // ── 2. Open Graph / meta fallback ───────────────────────────────────────
      const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
        ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1]
      const ogDesc  = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1]
        ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i)?.[1]

      if (ogTitle) {
        return res.status(200).json({
          found: true,
          name: ogTitle,
          description: ogDesc ?? null,
          productUrl: finalUrl,
        })
      }
    } catch { /* network error or timeout, try next */ }
  }

  return res.status(200).json({ found: false })
}
