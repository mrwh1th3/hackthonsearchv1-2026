-- =====================================================================
-- db/seeds/catalogo_giros.sql — Catálogo ClaveProdServ por giro.
--
-- Fuente: generator/giros.py (docs/05: "catalogo_giro_claves se carga desde
-- generator/giros.py y queda versionado con version_reglas, para que D1 no
-- dependa de un catálogo ausente en SQL"). Regenerable con:
--
--   python3 - <<'EOF'
--   import sys; sys.path.insert(0,'generator')
--   from giros import GIROS
--   ...  (ver el commit que introdujo este archivo)
--   EOF
--
-- Se aplica A MANO después de 001+002, antes de correr D1:
--   psql -d forense -f db/seeds/catalogo_giros.sql
--
-- Inserta una fila por (version_reglas, giro, clave) para CADA version_reglas
-- que exista en forense.corridas: el catálogo va versionado con las reglas,
-- no con el dataset. Idempotente.
-- =====================================================================

insert into forense.catalogo_giro_claves (version_reglas, giro, clave_prod_serv)
select r.version_reglas, c.giro, c.clave
  from (select distinct version_reglas from forense.corridas
         where version_reglas is not null) r
  cross join (values
  ('comercializadora','31162800'),
  ('comercializadora','43211500'),
  ('comercializadora','43211900'),
  ('comercializadora','44103100'),
  ('construccion','72102900'),
  ('construccion','72141100'),
  ('construccion','72151500'),
  ('consultoria','80101500'),
  ('consultoria','80101600'),
  ('consultoria','80101700'),
  ('despacho_contable','80121600'),
  ('despacho_contable','84111500'),
  ('despacho_contable','84111600'),
  ('manufactura','23153000'),
  ('manufactura','25174800'),
  ('manufactura','31162800'),
  ('marketing','82101500'),
  ('marketing','82101600'),
  ('marketing','82121500'),
  ('restaurante','90101500'),
  ('restaurante','90101600'),
  ('restaurante','90151800'),
  ('servicios_personal','80111500'),
  ('servicios_personal','80111600'),
  ('servicios_personal','80111700'),
  ('tecnologia','43232700'),
  ('tecnologia','81111500'),
  ('tecnologia','81111800'),
  ('transporte','78101700'),
  ('transporte','78101800'),
  ('transporte','78141500')
) as c(giro, clave)
on conflict (version_reglas, giro, clave_prod_serv) do nothing;

-- Sin corridas todavía: el catálogo se siembra bajo la versión por omisión
-- para que una corrida creada después con esa versión ya lo encuentre.
insert into forense.catalogo_giro_claves (version_reglas, giro, clave_prod_serv)
select 'pistas-1', c.giro, c.clave
  from (values
  ('comercializadora','31162800'),
  ('comercializadora','43211500'),
  ('comercializadora','43211900'),
  ('comercializadora','44103100'),
  ('construccion','72102900'),
  ('construccion','72141100'),
  ('construccion','72151500'),
  ('consultoria','80101500'),
  ('consultoria','80101600'),
  ('consultoria','80101700'),
  ('despacho_contable','80121600'),
  ('despacho_contable','84111500'),
  ('despacho_contable','84111600'),
  ('manufactura','23153000'),
  ('manufactura','25174800'),
  ('manufactura','31162800'),
  ('marketing','82101500'),
  ('marketing','82101600'),
  ('marketing','82121500'),
  ('restaurante','90101500'),
  ('restaurante','90101600'),
  ('restaurante','90151800'),
  ('servicios_personal','80111500'),
  ('servicios_personal','80111600'),
  ('servicios_personal','80111700'),
  ('tecnologia','43232700'),
  ('tecnologia','81111500'),
  ('tecnologia','81111800'),
  ('transporte','78101700'),
  ('transporte','78101800'),
  ('transporte','78141500')
) as c(giro, clave)
on conflict (version_reglas, giro, clave_prod_serv) do nothing;
