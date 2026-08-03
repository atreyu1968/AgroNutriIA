import { pool } from "@workspace/db";

/**
 * Protección a nivel de base de datos de las facturas emitidas.
 *
 * Complementa la huella encadenada (VeriFactu): además de detectar
 * manipulaciones, estos triggers las impiden directamente en PostgreSQL,
 * aunque el cambio venga de un acceso directo a la base de datos.
 *
 * Reglas:
 *  - UPDATE: solo pueden cambiar los campos de estado (`status`, `sent_at`,
 *    `paid_at`) y `updated_at`. Cualquier cambio en un campo fiscal
 *    (numeración, fechas, emisor, cliente, importes, huellas…) se rechaza.
 *  - El estado solo admite los valores issued | sent | paid.
 *  - DELETE y TRUNCATE: prohibidos siempre; el trigger no consulta ninguna
 *    variable de sesión, así que no existe llave de bypass por SET/SET LOCAL.
 *
 * Modelo de confianza: en este entorno la aplicación se conecta con el rol
 * propietario de la base de datos (Postgres gestionado con un único rol), de
 * modo que quien tenga esas credenciales y privilegios DDL podría desactivar
 * los triggers (ALTER TABLE … DISABLE TRIGGER). La protección bloquea todo
 * DML directo —errores humanos, scripts, consolas SQL y código de la propia
 * aplicación— y obliga a que cualquier bypass sea un acto DDL explícito y
 * auditable. Si el despliegue dispone de roles separados, basta con conceder
 * al rol de runtime solo SELECT/INSERT/UPDATE sobre `invoices` (sin
 * ALTER/TRUNCATE) para que el bypass sea imposible; los triggers se
 * instalarían entonces desde la conexión administrativa de despliegue.
 */
const INVOICE_GUARD_SQL = `
CREATE OR REPLACE FUNCTION invoices_block_fiscal_update() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
     OR NEW.charge_id IS DISTINCT FROM OLD.charge_id
     OR NEW.series IS DISTINCT FROM OLD.series
     OR NEW.year IS DISTINCT FROM OLD.year
     OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.full_number IS DISTINCT FROM OLD.full_number
     OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
     OR NEW.period IS DISTINCT FROM OLD.period
     OR NEW.issuer_name IS DISTINCT FROM OLD.issuer_name
     OR NEW.issuer_tax_id IS DISTINCT FROM OLD.issuer_tax_id
     OR NEW.issuer_address IS DISTINCT FROM OLD.issuer_address
     OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
     OR NEW.customer_tax_id IS DISTINCT FROM OLD.customer_tax_id
     OR NEW.customer_address IS DISTINCT FROM OLD.customer_address
     OR NEW.base_cents IS DISTINCT FROM OLD.base_cents
     OR NEW.farm_count IS DISTINCT FROM OLD.farm_count
     OR NEW.variable_cents IS DISTINCT FROM OLD.variable_cents
     OR NEW.subtotal_cents IS DISTINCT FROM OLD.subtotal_cents
     OR NEW.tax_rate_bps IS DISTINCT FROM OLD.tax_rate_bps
     OR NEW.tax_name IS DISTINCT FROM OLD.tax_name
     OR NEW.tax_cents IS DISTINCT FROM OLD.tax_cents
     OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
     OR NEW.prev_hash IS DISTINCT FROM OLD.prev_hash
     OR NEW.hash IS DISTINCT FROM OLD.hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Factura % emitida: los campos fiscales son inmutables (solo se permiten cambios de estado)', OLD.full_number
      USING ERRCODE = 'raise_exception';
  END IF;
  IF NEW.status NOT IN ('issued', 'sent', 'paid') THEN
    RAISE EXCEPTION 'Factura %: estado no permitido "%"', OLD.full_number, NEW.status
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION invoices_block_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Factura % emitida: no puede borrarse', OLD.full_number
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoices_protect_update ON invoices;
CREATE TRIGGER invoices_protect_update
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_block_fiscal_update();

CREATE OR REPLACE FUNCTION invoices_block_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Las facturas emitidas no pueden vaciarse (TRUNCATE bloqueado)'
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoices_protect_delete ON invoices;
CREATE TRIGGER invoices_protect_delete
  BEFORE DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_block_delete();

DROP TRIGGER IF EXISTS invoices_protect_truncate ON invoices;
CREATE TRIGGER invoices_protect_truncate
  BEFORE TRUNCATE ON invoices
  FOR EACH STATEMENT EXECUTE FUNCTION invoices_block_truncate();
`;

/**
 * Instala (de forma idempotente) los triggers que protegen las facturas.
 * Se ejecuta en el arranque del servidor.
 */
export async function ensureInvoiceGuards(): Promise<void> {
  await pool.query(INVOICE_GUARD_SQL);
}
