-- 026: resultados del auditor (src/auditor, docs/23) por corrida, para que la webapp
-- muestre lo mismo que se entrega a los jueces: submission, run log y expediente HTML.
CREATE TABLE IF NOT EXISTS forense.auditor_resultados (
  corrida_id   uuid PRIMARY KEY REFERENCES forense.corridas(id) ON DELETE CASCADE,
  seed         int NOT NULL,
  fingerprint  text NOT NULL,
  estate_sha256 text NOT NULL,
  submission   jsonb NOT NULL,
  run_log      jsonb NOT NULL,
  case_file_html text NOT NULL,
  generado_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE forense.auditor_resultados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lectura ON forense.auditor_resultados;
CREATE POLICY lectura ON forense.auditor_resultados FOR SELECT USING (true);
GRANT SELECT ON forense.auditor_resultados TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
