-- Rename the configured publication to a neutral demo identity so the product
-- can be shown to prospective publications. Data-only and keyed on id, so it
-- is a no-op on a fresh local database, where seed.sql creates the row.
update public.publications
   set slug = 'demo', name = 'Duly Noted Demo'
 where id = 'eaad9df3-6404-4372-a238-6321704405f5';
