-- 025: exponer el esquema forense a la API REST (lo lee la webapp con anon) y
-- cerrar ground_truth a anon/authenticated antes de exponerlo (docs/23: la clave
-- de evaluación nunca es alcanzable desde fuera del harness).
REVOKE ALL ON forense.ground_truth FROM anon, authenticated;
ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, forense';
NOTIFY pgrst, 'reload config';
