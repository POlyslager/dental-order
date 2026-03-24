import type { VercelRequest, VercelResponse } from '@vercel/node'

export interface Alternative {
  domain: string
  name: string | null
  url: string
  price: number
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
}

// Search URL patterns — {q} is replaced with encodeURIComponent(productName)
// Multiple patterns are tried in order until one returns products
const SITES: { domain: string; base: string; searches: string[] }[] = [
  // ── Dental-specific ────────────────────────────────────────────────────────
  { domain: 'henryschein-dental.de',   base: 'https://www.henryschein-dental.de',   searches: ['/search?q={q}', '/search?query={q}'] },
  { domain: 'minilu.de',               base: 'https://www.minilu.de',               searches: ['/search?q={q}', '/?sSearch={q}'] },
  { domain: 'dentina.de',              base: 'https://www.dentina.de',              searches: ['/?sSearch={q}', '/search?q={q}'] },
  { domain: 'dentalkauf24.com',        base: 'https://www.dentalkauf24.com',        searches: ['/search?q={q}', '/?sSearch={q}'] },
  { domain: 'multi-com.de',           base: 'https://www.multi-com.de',            searches: ['/search?q={q}', '/?sSearch={q}'] },
  { domain: 'mwdental.de',             base: 'https://www.mwdental.de',             searches: ['/search?q={q}', '/?sSearch={q}'] },
  { domain: 'dentalbauer.de',          base: 'https://www.dentalbauer.de',          searches: ['/shop/cat/index/?sSearch={q}', '/search?q={q}'] },
  { domain: 'kaniedenta.de',           base: 'https://www.kaniedenta.de',           searches: ['/search?q={q}', '/?sSearch={q}'] },
  { domain: 'netdental.de',            base: 'https://shop.netdental.de',           searches: ['/search?q={q}', '/?sSearch={q}'] },
  { domain: 'medic-star.de',           base: 'https://www.medic-star.de',           searches: ['/search?q={q}', '/?sSearch={q}'] },
  { domain: 'praxisdienst.com',        base: 'https://www.praxisdienst.com',        searches: ['/search?q={q}', '/catalogsearch/result/?q={q}'] },
  { domain: 'direct-onlinehandel.de',  base: 'https://shop.direct-onlinehandel.de', searches: ['/search?q={q}', '/?sSearch={q}'] },
  { domain: 'pluradent.de',            base: 'https://www.pluradent.de',            searches: ['/search?q={q}', '/?sSearch={q}'] },
  { domain: 'aera-online.de',          base: 'https://www.aera-online.de',          searches: ['/search?q={q}', '/search?query={q}'] },
  // ── General medical / pharmacy ─────────────────────────────────────────────
  { domain: 'aponeo.de',               base: 'https://www.aponeo.de',               searches: ['/?sSearch={q}', '/suche.html?sSearch={q}'] },
  { domain: 'shop-apotheke.com',       base: 'https://www.shop-apotheke.com',       searches: ['/search?q={q}', '/search?query={q}'] },
  { domain: 'docmorris.de',            base: 'https://www.docmorris.de',            searches: ['/search?q={q}', '/suche?q={q}'] },
  { domain: 'medizinfuchs.de',         base: 'https://www.medizinfuchs.de',         searches: ['/?s={q}', '/search?q={q}'] },
  { domain: 'medicalcorner24.de',      base: 'https://www.medicalcorner24.de',      searches: ['/search?q={q}', '/?sSearch={q}'] },
  { domain: 'ampri.de',                base: 'https://www.ampri.de',                searches: ['/search?q={q}', '/?sSearch={q}'] },
  { domain: 'amazon.de',               base: 'https://www.amazon.de',               searches: ['/s?k={q}'] },
]

function extractPrice(offers: unknown): number | null {
  if (!offers) return null
  const o = (Array.isArray(offers) ? offers[0] : offers) as Record<string, unknown>
  const raw = o?.price ?? o?.lowPrice
  if (raw == null) return null
  const n = parseFloat(String(raw).replace(',', '.'))
  return isNaN(n) || n <= 0 ? null : n
}

function extractProductsFromHtml(html: string, pageUrl: string): { name: string | null; price: number; url: string }[] {
  const found: { name: string | null; price: number; url: string }[] = []

  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1])
      const roots = Array.isArray(parsed) ? parsed : [parsed]
      for (const root of roots) {
        const nodes: unknown[] = root['@graph'] ? root['@graph'] : [root]
        for (const n of nodes) {
          const node = n as Record<string, unknown>
          const type = node['@type']

          // Direct Product node
          if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) {
            const price = extractPrice(node.offers)
            if (price != null) {
              const offerUrl = ((node.offers as Record<string, unknown>)?.url ?? (Array.isArray(node.offers) ? (node.offers[0] as Record<string, unknown>)?.url : null)) as string | null
              found.push({ name: (node.name as string) ?? null, price, url: offerUrl ?? pageUrl })
            }
          }

          // ItemList containing products
          if (type === 'ItemList') {
            for (const el of ((node.itemListElement as unknown[]) ?? [])) {
              const item = ((el as Record<string, unknown>).item ?? el) as Record<string, unknown>
              if (item['@type'] === 'Product' || item.name) {
                const price = extractPrice(item.offers)
                if (price != null) {
                  found.push({ name: (item.name as string) ?? null, price, url: (item.url as string) ?? pageUrl })
                }
              }
            }
          }
        }
      }
    } catch { /* malformed JSON-LD */ }
  }

  return found
}

async function searchSite(site: typeof SITES[number], query: string): Promise<Alternative | null> {
  const q = encodeURIComponent(query)
  for (const searchPath of site.searches) {
    const url = site.base + searchPath.replace('{q}', q)
    try {
      const res = await fetch(url, {
        headers: HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(6000),
      })
      if (!res.ok) continue
      const html = await res.text()
      const products = extractProductsFromHtml(html, res.url)
      if (products.length > 0) {
        // Return cheapest result found on this site
        products.sort((a, b) => a.price - b.price)
        return { domain: site.domain, name: products[0].name, url: products[0].url, price: products[0].price }
      }
    } catch { /* timeout or network error — try next pattern */ }
  }
  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { productName } = req.body as { productName?: string }
  if (!productName?.trim()) return res.status(400).json({ error: 'productName required' })

  const settled = await Promise.allSettled(SITES.map(site => searchSite(site, productName.trim())))

  const results: Alternative[] = settled
    .filter((r): r is PromiseFulfilledResult<Alternative> => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value)
    .sort((a, b) => a.price - b.price)

  return res.status(200).json({ results, searchedCount: SITES.length })
}
