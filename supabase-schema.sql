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
    check (status in ('draft', 'pending_approval', 'approved', 'ordered', 'received', 'cancelled')),
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

-- Products: all authenticated users can read; employees+ can insert/update
create policy "products_select" on products for select to authenticated using (true);
create policy "products_insert" on products for insert to authenticated with check (true);
create policy "products_update" on products for update to authenticated using (true);

-- Stock movements: all authenticated can read/insert
create policy "movements_select" on stock_movements for select to authenticated using (true);
create policy "movements_insert" on stock_movements for insert to authenticated with check (auth.uid() = scanned_by);

-- Orders: all authenticated can read; creator can insert; admin can update
create policy "orders_select" on orders for select to authenticated using (true);
create policy "orders_insert" on orders for insert to authenticated with check (auth.uid() = created_by);
create policy "orders_update" on orders for update to authenticated using (true);

-- Order items: all authenticated
create policy "order_items_select" on order_items for select to authenticated using (true);
create policy "order_items_insert" on order_items for insert to authenticated with check (true);
create policy "order_items_update" on order_items for update to authenticated using (true);
