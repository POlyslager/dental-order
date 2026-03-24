import type { VercelRequest, VercelResponse } from '@vercel/node'

const HTML_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
}

function tokenise(s: string): Set<string> {
  const words = s.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !/^\d+$/.test(w))
  const nums: string[] = []
  for (const m of s.matchAll(/\d[\d.,]+/g)) {
    const n = m[0].replace(/[.,]/g, '')
    if (n.length >= 5) nums.push(n)
  }
  return new Set([...words, ...nums])
}

function nameMatches(query: string, resultName: string | null): boolean {
  if (!resultName) return false
  const qTokens = tokenise(query)
  const rTokens = tokenise(resultName)
  let wordMatches = 0
  for (const t of qTokens) {
    if (!/^\d+$/.test(t) && rTokens.has(t)) wordMatches++
  }
  if (wordMatches < 1) return false
  for (const t of qTokens) {
    if (/^\d+$/.test(t) && !rTokens.has(t)) return false
  }
  return true
}

function extractPrice(offers: unknown): number | null {
  if (!offers) return null
  const o = (Array.isArray(offers) ? offers[0] : offers) as Record<string, unknown>
  const raw = o?.price ?? o?.lowPrice
  if (raw == null) return null
  const n = parseFloat(String(raw).replace(',', '.'))
  return isNaN(n) || n <= 0 ? null : n
}

function extractProductsFromHtml(html: string, pageUrl: string) {
  const found: { name: string | null; price: number; url: string }[] = []
  for (const block of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
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
        }
      }
    } catch { /* malformed JSON-LD */ }
  }
  return found
}

function extractProductsFromMicrodata(html: string, pageUrl: string) {
  const found: { name: string | null; price: number; url: string }[] = []

  for (const m of html.matchAll(/itemprop=["']price["'][^>]*content=["']([0-9.,]+)["']/gi)) {
    const price = parseFloat((m[1]).replace(',', '.'))
    if (!price || price <= 0) continue
    const ctx = html.slice(Math.max(0, m.index! - 3000), m.index!)
    const nameM = [...ctx.matchAll(/itemprop=["']name["'][^>]*(?:content=["']([^"']+)["']|>([^<]{3,80})<)/gi)].pop()
    const urlM = [...ctx.matchAll(/(?:itemprop=["']url["'][^>]*(?:content|href)=["']|href=["'])([^"']+)["']/gi)].pop()
    let name = nameM ? (nameM[1] ?? nameM[2] ?? '').trim() || null : null
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { searchUrl, query } = req.body as { searchUrl?: string; query?: string }
  if (!searchUrl?.trim() || !query?.trim()) return res.status(400).json({ error: 'searchUrl and query required' })

  const url = searchUrl.replace('{q}', encodeURIComponent(query.trim()))

  try {
    let response = await fetch(url, {
      headers: HTML_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return res.status(200).json({ found: false, error: `HTTP ${response.status}` })

    // If a redirect stripped the query string (e.g. www → non-www redirect on Magento), re-fetch with query appended
    if (response.url !== url && !response.url.includes('?') && url.includes('?')) {
      const corrected = response.url + '?' + url.split('?')[1]
      const retry = await fetch(corrected, { headers: HTML_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(8000) })
      if (retry.ok) response = retry
    }

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
