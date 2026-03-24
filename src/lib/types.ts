export type Role = 'employee' | 'admin'

export interface SupplierHistoryEntry {
  id: string
  product_id: string
  supplier_name: string | null
  supplier_url: string | null
  price: number | null
  set_at: string
  set_by: string | null
  source: string | null
}

export interface Category {
  id: string
  name: string
  description: string | null
  created_at: string
}

export interface PriceComparisonShop {
  id: string
  base_url: string
  search_paths: string[]
  is_active: boolean
  notes: string | null
  min_order_value: number | null
  created_at: string
}

export interface PriceAlternative {
  domain: string
  name: string | null
  url: string
  price: number
}

export interface Profile {
  id: string
  email: string
  full_name: string
  role: Role
  created_at: string
}

export interface Product {
  id: string
  article_number: string | null
  name: string
  description: string | null
  barcode: string | null
  category: string
  current_stock: number
  min_stock: number
  unit: string
  preferred_supplier: string | null
  supplier_url: string | null
  producer_url: string | null
  last_price: number | null
  image_url: string | null
  notes: string | null
  expiry_date: string | null
  storage_location: string | null
  reorder_quantity: number | null
  alternative_price: number | null
  alternative_url: string | null
  alternative_supplier: string | null
  created_at: string
}

export interface StockMovement {
  id: string
  product_id: string
  type: 'scan_in' | 'scan_out' | 'manual_in' | 'manual_out'
  quantity: number
  scanned_by: string
  notes: string | null
  created_at: string
  product?: Product
}

export interface CartItem {
  id: string
  product_id: string
  quantity: number
  added_by: string | null
  created_at: string
  product?: Product
}

export type OrderStatus = 'draft' | 'pending_approval' | 'approved' | 'ordered' | 'received' | 'cancelled'

export interface Order {
  id: string
  status: OrderStatus
  supplier: string | null
  created_by: string
  approved_by: string | null
  notes: string | null
  total_estimate: number | null
  created_at: string
  updated_at: string
  items?: OrderItem[]
  creator?: Profile
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string
  quantity: number
  supplier_url: string | null
  estimated_price: number | null
  alternative_product_name: string | null
  alternative_url: string | null
  alternative_price: number | null
  voucher_code: string | null
  voucher_discount: number | null
  created_at: string
  product?: Product
}
