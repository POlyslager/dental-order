import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

export interface Alternative {
  domain: string
  name: string | null
  url: string
  price: number
}

export const HTML_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
}

const JSON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
}

const adminClient = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ── Name relevance check ────────────────────────────────────────────────────
// Tokenise a string into meaningful lowercase words (4+ chars, non-numeric)
export function tokenise(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !/^\d+$/.test(w))
  )
}

// Returns true if the result name shares enough tokens with the search query
export function nameMatches(query: string, resultName: string | null): boolean {
  if (!resultName) return false
  const qTokens = tokenise(query)
  const rTokens = tokenise(resultName)
  let matches = 0
  for (const t of qTokens) { if (rTokens.has(t)) matches++ }
  // 1 match is enough — product names are specific and synonyms are common (e.g. Epinephrin/Adrenalin)
  return matches >= 1
}

// ── JSON-LD extraction ───────────────────────────────────────────────────────
function extractPrice(offers: unknown): number | null {
  if (!offers) return null
  const o = (Array.isArray(offers) ? offers[0] : offers) as Record<string, unknown>
  const raw = o?.price ?? o?.lowPrice
  if (raw == null) return null
  const n = parseFloat(String(raw).replace(',', '.'))
  return isNaN(n) || n <= 0 ? null : n
}

export function extractProductsFromHtml(html: string, pageUrl: string): { name: string | null; price: number; url: string }[] {
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
          if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) {
            const price = extractPrice(node.offers)
            if (price != null) {
              const offerUrl = ((node.offers as Record<string, unknown>)?.url
                ?? (Array.isArray(node.offers) ? (node.offers[0] as Record<string, unknown>)?.url : null)) as string | null
              found.push({ name: (node.name as string) ?? null, price, url: offerUrl ?? pageUrl })
            }
          }
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

// ── dm.de — dedicated JSON API ───────────────────────────────────────────────
// Price lives at product.price.price.current.value as a string e.g. "2,45 €"
async function searchDm(query: string): Promise<Alternative | null> {
  try {
    const url = `https://product-search.services.dmtech.com/de/search/crawl?query=${encodeURIComponent(query)}&pageSize=5`
    const res = await fetch(url, { headers: JSON_HEADERS, signal: AbortSignal.timeout(4000) })
    if (!res.ok) return null
    const data = await res.json() as {
      products?: {
        title?: string
        brandName?: string
        price?: { price?: { current?: { value?: string } } }
        relativeProductUrl?: string
      }[]
    }
    for (const p of data.products ?? []) {
      const rawPrice = p.price?.price?.current?.value
      if (!rawPrice) continue
      const price = parseFloat(rawPrice.replace(',', '.').replace(/[^\d.]/g, ''))
      if (!price || price <= 0) continue
      const name = [p.brandName, p.title].filter(Boolean).join(' ')
      if (!nameMatches(query, name)) continue
      return {
        domain: 'dm.de',
        name,
        url: `https://www.dm.de${p.relativeProductUrl ?? ''}`,
        price,
      }
    }
  } catch { /* timeout */ }
  return null
}

// ── Microdata / class-price fallback ─────────────────────────────────────────
export function extractProductsFromMicrodata(html: string, pageUrl: string): { name: string | null; price: number; url: string }[] {
  const found: { name: string | null; price: number; url: string }[] = []

  // Strategy 1: itemprop="price" content="..." — works for OXID, Magento, schema.org microdata
  for (const m of html.matchAll(/itemprop=["']price["'][^>]*content=["']([0-9.,]+)["']/gi)) {
    const price = parseFloat((m[1]).replace(',', '.'))
    if (!price || price <= 0) continue
    // Look backwards up to 3000 chars for the nearest product name and URL
    const ctx = html.slice(Math.max(0, m.index! - 3000), m.index!)
    const nameM = [...ctx.matchAll(/itemprop=["']name["'][^>]*(?:content=["']([^"']+)["']|>([^<]{3,80})<)/gi)].pop()
    const urlM = [...ctx.matchAll(/(?:itemprop=["']url["'][^>]*(?:content|href)=["']|href=["'])([^"']+)["']/gi)].pop()
    let name = nameM ? (nameM[1] ?? nameM[2] ?? '').trim() || null : null
    // Fallback for product detail pages (e.g. Shopware): name is in <h1 itemprop="name"> far above the price
    if (!name) {
      const h1M = html.match(/<h1[^>]*itemprop=["']name["'][^>]*>\s*([^<]{3,120})/i)
             ?? html.match(/itemprop=["']name["'][^>]*>\s*([^<]{3,120})<\/h1>/i)
      if (h1M) name = h1M[1].trim() || null
    }
    const rawUrl = urlM?.[1] ?? ''
    const url = rawUrl.startsWith('http') ? rawUrl : rawUrl.startsWith('/') ? new URL(rawUrl, pageUrl).href : pageUrl
    found.push({ name, price, url })
  }
  if (found.length > 0) return found

  // Strategy 2: data-price-amount (Magento listing pages) — only finalPrice to skip old/tier prices
  for (const m of html.matchAll(/data-price-amount=["']([0-9.,]+)["'][^>]*data-price-type=["']finalPrice["']/gi)) {
    const price = parseFloat((m[1]).replace(',', '.'))
    if (!price || price <= 0) continue
    const ctx = html.slice(Math.max(0, m.index! - 2000), m.index!)
    const nameM = [...ctx.matchAll(/itemprop=["']name["'][^>]*(?:content=["']([^"']+)["']|>([^<]{3,80})<)/gi)].pop()
      ?? [...ctx.matchAll(/class=["'][^"']*product[^"']*(?:name|title)[^"']*["'][^>]*>([^<]{3,80})</gi)].pop()
    const linkName = [...ctx.matchAll(/<a[^>]+class="[^"]*product-item-link[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(n => n.length >= 3).pop() ?? null
    const urlM = [...ctx.matchAll(/href=["']([^"']+)["']/gi)].pop()
    const name = nameM ? (nameM[1] ?? nameM[2] ?? '').trim() || linkName : linkName
    const rawUrl = urlM?.[1] ?? ''
    const url = rawUrl.startsWith('http') ? rawUrl : rawUrl.startsWith('/') ? new URL(rawUrl, pageUrl).href : pageUrl
    found.push({ name, price, url })
  }
  if (found.length > 0) return found

  // Strategy 3: <span class="price">27,25 €</span> — Magento when data-price-amount=0
  for (const m of html.matchAll(/<span\s+class="price">([0-9][0-9.,]*\s*€?)<\/span>/gi)) {
    const raw = m[1].replace(/[€\s]/g, '').replace(',', '.')
    const price = parseFloat(raw)
    if (!price || price <= 0) continue
    const ctx = html.slice(Math.max(0, m.index! - 2000), m.index!)
    const linkName = [...ctx.matchAll(/<a[^>]+class="[^"]*product-item-link[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(n => n.length >= 3).pop() ?? null
    const nameM = [...ctx.matchAll(/itemprop=["']name["'][^>]*(?:content=["']([^"']+)["']|>([^<]{3,80})<)/gi)].pop()
    const urlM = [...ctx.matchAll(/href=["']([^"']+)["']/gi)].pop()
    const name = linkName ?? (nameM ? (nameM[1] ?? nameM[2] ?? '').trim() || null : null)
    const rawUrl = urlM?.[1] ?? ''
    const url = rawUrl.startsWith('http') ? rawUrl : rawUrl.startsWith('/') ? new URL(rawUrl, pageUrl).href : pageUrl
    found.push({ name, price, url })
  }
  return found
}

// ── HTML-scraping sites ───────────────────────────────────────────────────────
async function searchSite(site: { domain: string; searches: string[] }, query: string): Promise<Alternative | null> {
  const q = encodeURIComponent(query)
  for (const searchPath of site.searches) {
    const url = searchPath.replace('{q}', q)
    try {
      const res = await fetch(url, { headers: HTML_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(6000) })
      console.log(`[${site.domain}] ${url} → ${res.status} ${res.statusText}`)
      if (!res.ok) { console.log(`[${site.domain}] skipped: non-OK status`); continue }
      const html = await res.text()
      const hasJsonLd = html.includes('application/ld+json')
      const hasItemprop = html.includes('itemprop')
      const hasPrice = /itemprop=.price|class=.price|data-price/i.test(html)
      console.log(`[${site.domain}] html=${html.length}b json-ld=${hasJsonLd} itemprop=${hasItemprop} price-hint=${hasPrice}`)
      let products = extractProductsFromHtml(html, res.url).filter(p => nameMatches(query, p.name))
      console.log(`[${site.domain}] JSON-LD products found: ${products.length}`)
      if (products.length === 0) {
        products = extractProductsFromMicrodata(html, res.url).filter(p => nameMatches(query, p.name))
        console.log(`[${site.domain}] microdata products found: ${products.length}`)
      }
      if (products.length > 0) {
        products.sort((a, b) => a.price - b.price)
        return { domain: site.domain, name: products[0].name, url: products[0].url, price: products[0].price }
      }
    } catch (e) { console.log(`[${site.domain}] error: ${e}`) }
  }
  return null
}

// ── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { productName, brand } = req.body as { productName?: string; brand?: string }
  if (!productName?.trim()) return res.status(400).json({ error: 'productName required' })

  const name = productName.trim()
  const brandTrimmed = brand?.trim() ?? ''
  // Only prepend brand if it's not already part of the product name
  const query = brandTrimmed && !name.toLowerCase().includes(brandTrimmed.toLowerCase())
    ? `${brandTrimmed} ${name}`
    : name

  const { data: shopRows } = await adminClient
    .from('price_comparison_shops')
    .select('base_url, search_paths')
    .eq('is_active', true)

  const htmlShops = (shopRows ?? [])
    .filter(r => !new URL(r.base_url as string).hostname.includes('dm.de'))
    .map(r => ({
      domain: new URL(r.base_url as string).hostname.replace(/^www\./, ''),
      searches: r.search_paths as string[],
    }))
  const hasDm = (shopRows ?? []).some(r => new URL(r.base_url as string).hostname.includes('dm.de'))

  const settled = await Promise.allSettled([
    ...htmlShops.map(site => searchSite(site, query)),
    ...(hasDm ? [searchDm(query)] : []),
  ])

  const results: Alternative[] = settled
    .filter((r): r is PromiseFulfilledResult<Alternative> => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value)
    .sort((a, b) => a.price - b.price)

  return res.status(200).json({ results, searchedCount: (shopRows ?? []).length })
}
