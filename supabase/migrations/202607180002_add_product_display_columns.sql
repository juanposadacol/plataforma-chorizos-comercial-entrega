alter table public.products
add column if not exists featured boolean not null default false;

alter table public.products
add column if not exists image_url text;

notify pgrst, 'reload schema';
