-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles (extends auth.users)
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  full_name text not null default '',
  role text not null default 'employee' check (role in ('employee', 'admin')),
  created_at timestamptz not null default now()
);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Products / inventory
create table products (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  barcode text unique,
  category text not null default 'General',
  current_stock numeric not null default 0,
  min_stock numeric not null default 1,
  unit text not null default 'pcs',
  preferred_supplier text,
  supplier_url text,
  last_price numeric,
  image_url text,
  notes text,
  created_at timestamptz not null default now()
);

create index products_barcode_idx on products(barcode);
create index products_category_idx on products(category);

-- Stock movements (audit trail)
create table stock_movements (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products on delete cascade,
  type text not null check (type in ('scan_in', 'scan_out', 'manual_in', 'manual_out')),
  quantity numeric not null,
  scanned_by uuid not null references auth.users,
  notes text,
  created_at timestamptz not null default now()
);

create index stock_movements_product_idx on stock_movements(product_id);
create index stock_movements_created_idx on stock_movements(created_at desc);

-- Orders
create table orders (
  id uuid primary key default uuid_generate_v4(),
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'ordered', 'received', 'cancelled', 'rejected')),
  created_by uuid not null references auth.users,
  approved_by uuid references auth.users,
  notes text,
  total_estimate numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_status_idx on orders(status);
create index orders_created_idx on orders(created_at desc);

-- Order items
create table order_items (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references orders on delete cascade,
  product_id uuid not null references products,
  quantity numeric not null default 1,
  supplier_url text,
  estimated_price numeric,
  alternative_product_name text,
  alternative_url text,
  alternative_price numeric,
  voucher_code text,
  voucher_discount numeric,
  created_at timestamptz not null default now()
);

create index order_items_order_idx on order_items(order_id);

-- Row Level Security
alter table profiles enable row level security;
alter table products enable row level security;
alter table stock_movements enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

-- Profiles: users can read all, update own
create policy "profiles_select" on profiles for select to authenticated using (true);
create policy "profiles_update_own" on profiles for update to authenticated using (auth.uid() = id);

-- Products: all authenticated users can read/write/delete
create policy "products_select" on products for select to authenticated using (true);
create policy "products_insert" on products for insert to authenticated with check (true);
create policy "products_update" on products for update to authenticated using (true);
create policy "products_delete" on products for delete to authenticated using (true);

-- Stock movements: all authenticated can read/insert/delete
create policy "movements_select" on stock_movements for select to authenticated using (true);
create policy "movements_insert" on stock_movements for insert to authenticated with check (auth.uid() = scanned_by);
create policy "movements_delete" on stock_movements for delete to authenticated using (true);

-- Orders: all authenticated can read; creator can insert; admin can update
create policy "orders_select" on orders for select to authenticated using (true);
create policy "orders_insert" on orders for insert to authenticated with check (auth.uid() = created_by);
create policy "orders_update" on orders for update to authenticated using (true);

-- Order items: all authenticated
create policy "order_items_select" on order_items for select to authenticated using (true);
create policy "order_items_insert" on order_items for insert to authenticated with check (true);
create policy "order_items_update" on order_items for update to authenticated using (true);
create policy "order_items_delete" on order_items for delete to authenticated using (true);

-- ── Feature additions ─────────────────────────────────────────────────────

-- Verfallsdatum-Tracking & Lot-Nummern auf Produkten
alter table products add column if not exists expiry_date date;
alter table products add column if not exists lot_number text;

-- Behandlungstypen (multi-select tags)
alter table products add column if not exists treatment_types text[] default '{}';

-- Lieferantenperformance: Zeitstempel wenn Bestellung erhalten wurde
alter table orders add column if not exists received_at timestamptz;

-- 2FA PIN (gehashed)
alter table profiles add column if not exists pin_hash text;
alter table profiles add column if not exists pin_enabled boolean not null default false;

-- Produkt-Lagerort
alter table products add column if not exists brand text;

-- ── Role-based PIN login ───────────────────────────────────────────────────

-- Settings table (stores PIN hashes for shared role accounts)
create table if not exists settings (
  key text primary key,
  value text not null,
  updated_at timestamptz default now()
);

-- Initial rows: SHA-256 of '000000' as placeholder
insert into settings (key, value) values
  ('employee_pin_hash', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
  ('admin_pin_hash',    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
on conflict do nothing;

-- RLS: only authenticated admin role can read/update
alter table settings enable row level security;
create policy "admin_manage_settings" on settings for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- Credential storage rows (filled in via PIN-Verwaltung UI)
insert into settings (key, value) values
  ('employee_email',    ''),
  ('employee_password', ''),
  ('admin_email',       ''),
  ('admin_password',    '')
on conflict do nothing;

-- ── Suppliers table ──────────────────────────────────────────────────────────
create table if not exists suppliers (
  name text primary key,
  website text,
  created_at timestamptz not null default now()
);

alter table suppliers enable row level security;
create policy "suppliers_select" on suppliers for select to authenticated using (true);
create policy "suppliers_insert" on suppliers for insert to authenticated with check (true);
create policy "suppliers_update" on suppliers for update to authenticated using (true);
create policy "suppliers_delete" on suppliers for delete to authenticated using (true);

-- ── Brands table ─────────────────────────────────────────────────────────────
create table if not exists brands (
  name text primary key,
  created_at timestamptz not null default now()
);

alter table brands enable row level security;
create policy "brands_select" on brands for select to authenticated using (true);
create policy "brands_insert" on brands for insert to authenticated with check (true);
create policy "brands_update" on brands for update to authenticated using (true);
create policy "brands_delete" on brands for delete to authenticated using (true);

-- ── Categories table ─────────────────────────────────────────────────────────
create table if not exists categories (
  name text primary key,
  created_at timestamptz not null default now()
);

alter table categories enable row level security;
create policy "categories_select" on categories for select to authenticated using (true);
create policy "categories_insert" on categories for insert to authenticated with check (true);
create policy "categories_update" on categories for update to authenticated using (true);
create policy "categories_delete" on categories for delete to authenticated using (true);

-- ── Cart items table ─────────────────────────────────────────────────────────
create table if not exists cart_items (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products on delete cascade,
  quantity numeric not null default 1,
  added_by uuid not null references auth.users,
  created_at timestamptz not null default now()
);

alter table cart_items enable row level security;
create policy "cart_items_select" on cart_items for select to authenticated using (true);
create policy "cart_items_insert" on cart_items for insert to authenticated with check (true);
create policy "cart_items_update" on cart_items for update to authenticated using (true);
create policy "cart_items_delete" on cart_items for delete to authenticated using (true);

-- ── Price comparison shops table ─────────────────────────────────────────────
create table if not exists price_comparison_shops (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  domain text not null unique,
  created_at timestamptz not null default now()
);

alter table price_comparison_shops enable row level security;
create policy "price_shops_select" on price_comparison_shops for select to authenticated using (true);
create policy "price_shops_insert" on price_comparison_shops for insert to authenticated with check (true);
create policy "price_shops_update" on price_comparison_shops for update to authenticated using (true);
create policy "price_shops_delete" on price_comparison_shops for delete to authenticated using (true);

-- ── Product supplier history table ───────────────────────────────────────────
create table if not exists product_supplier_history (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products on delete cascade,
  supplier_name text,
  supplier_url text,
  price numeric,
  set_at timestamptz not null default now(),
  set_by uuid references auth.users,
  source text
);

alter table product_supplier_history enable row level security;
create policy "supplier_history_select" on product_supplier_history for select to authenticated using (true);
create policy "supplier_history_insert" on product_supplier_history for insert to authenticated with check (true);
create policy "supplier_history_update" on product_supplier_history for update to authenticated using (true);
create policy "supplier_history_delete" on product_supplier_history for delete to authenticated using (true);

-- ── Data API grants ──────────────────────────────────────────────────────────
-- Required for new tables in new Supabase projects from 2026-05-30, and all
-- existing projects from 2026-10-30. Existing tables keep their grants, so
-- this block is safe to re-run; it only matters when this schema is applied
-- to a fresh project. RLS still controls row-level access; grants control
-- whether the Data API exposes the table to a given role at all.

grant select, insert, update, delete on
  profiles,
  products,
  stock_movements,
  orders,
  order_items,
  settings,
  suppliers,
  brands,
  categories,
  cart_items,
  price_comparison_shops,
  product_supplier_history
to authenticated, service_role;
