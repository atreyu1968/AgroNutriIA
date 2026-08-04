-- Migra los campos antiguos de agua desalada de la finca a fuentes de agua.
-- Se ejecuta ANTES de `drizzle push` (que elimina las columnas antiguas).
-- Idempotente: solo actúa si las columnas antiguas todavía existen y la finca
-- no tiene ya una fuente «Desaladora».
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'farms'
      AND column_name = 'has_desalinated_water'
  ) THEN
    -- En bases de datos antiguas la tabla water_sources puede no existir aún:
    -- se crea con el mismo esquema que definirá drizzle push.
    CREATE TABLE IF NOT EXISTS water_sources (
      id serial PRIMARY KEY,
      farm_id integer NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
      name text NOT NULL,
      share_pct real NOT NULL DEFAULT 0,
      created_at timestamp with time zone NOT NULL DEFAULT now()
    );

    INSERT INTO water_sources (farm_id, name, share_pct)
    SELECT f.id, 'Desaladora', COALESCE(f.desalinated_water_pct, 0)
    FROM farms f
    WHERE f.has_desalinated_water IS TRUE
      AND NOT EXISTS (
        SELECT 1 FROM water_sources ws
        WHERE ws.farm_id = f.id AND lower(ws.name) LIKE '%desal%'
      );
  END IF;
END $$;
