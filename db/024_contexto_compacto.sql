-- 024_contexto_compacto.sql — el paquete de contexto de ronda 1 superaba el
-- techo de 12 000 caracteres de todos los especialistas en los clusters
-- grandes (40 RFC: 28 905 y 40 266 bytes medidos en el remoto 2026-09-12), y
-- todas sus tareas fallaban antes de llamar al modelo (72 de 367 ejecuciones
-- reales). La causa medida: la misma pista (p. ej. R1 "comparte domicilio")
-- repetida por cada RFC del grupo con su resumen y referencias completas.
-- Se agrupa, se acota por familia y se recortan textos; el detalle vive en
-- las herramientas. Regla 5: el paquete ya no crece con el dataset.

create or replace function forense.preparar_contexto_ronda1(p_caso uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k record; cl record; v_corte timestamptz; v_fam text[]; v_contenido jsonb; v_hash text;
begin
  select * into k from forense.casos where id = p_caso;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;
  select * into cl from forense.clusters where id = k.cluster_id;
  select fecha_corte, familias_evaluables into v_corte, v_fam
    from forense.corridas where id = k.corrida_id;

  select jsonb_build_object(
    'caso_id', p_caso, 'cluster_id', k.cluster_id, 'corrida_id', k.corrida_id,
    'fecha_corte', forense.fecha_iso(v_corte),
    'familias_evaluables', to_jsonb(v_fam),
    'rfc_principal', k.rfc_principal,
    'version_contexto', cl.version_contexto,
    -- Entidades: tope 40 RFC (regla 5), razón social recortada (dato no confiable).
    'entidades', coalesce((
      -- tipo_persona se deduce del RFC (12 = moral, 13 = física); en_padron solo
      -- aparece cuando es false (jsonb_strip_nulls).
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'rfc', x.rfc, 'giro', c.giro,
               'razon_social_untrusted', left(c.razon_social, 20),
               'en_padron', case when c.rfc is null then false end)) order by x.rfc)
        from unnest(cl.rfcs[1:40]) x(rfc)
        left join forense.contribuyentes c
          on c.corrida_id = k.corrida_id and c.rfc = x.rfc), '[]'::jsonb),
    -- Pistas agrupadas: la misma pista (familia, código, referencias) sobre
    -- varios RFC del grupo va UNA vez con la lista de RFC. Tope 4 por familia,
    -- resumen 100 caracteres, 1 referencia + conteo. El detalle completo se
    -- obtiene con herramientas (perfil/facturas/relacionados).
    'pistas_por_familia', coalesce((
      select jsonb_object_agg(f.familia, f.j)
        from (select g.familia,
                     jsonb_agg(jsonb_build_object(
                       'id', g.id::text, 'codigo', g.codigo,
                       'rfcs', to_jsonb(g.rfcs[1:3]), 'n_rfcs', cardinality(g.rfcs),
                       'score', g.score, 'resumen', left(g.resumen, 100),
                       'referencias', (select coalesce(jsonb_agg(v), '[]'::jsonb)
                                         from (select v from jsonb_array_elements(g.refs) v limit 1) s),
                       'n_referencias', jsonb_array_length(g.refs))
                       order by g.score desc, g.id) as j
                from (select q.*, row_number() over (partition by q.familia order by q.score desc, q.id) rk
                        from (select p.familia, p.codigo,
                                     coalesce(p.detalle->'referencias', '[]'::jsonb) refs,
                                     array_agg(p.rfc order by p.rfc) rfcs, max(p.score) score, min(p.id) id,
                                     (array_agg(p.detalle->>'resumen' order by p.score desc, p.id))[1] resumen
                                from forense.pistas p
                               where p.corrida_id = k.corrida_id and p.rfc = any(cl.rfcs)
                                 and p.estado = 'disparada'
                               group by 1, 2, 3) q) g
               where g.rk <= 4
               group by g.familia) f), '{}'::jsonb),
    'frontera', coalesce(to_jsonb(cl.rfcs_frontera[1:20]), '[]'::jsonb))
    into v_contenido;

  v_hash := encode(sha256(convert_to(v_contenido::text, 'utf8')), 'hex');

  insert into forense.artefactos_contexto (hash, corrida_id, caso_id, contenido, bytes)
  values (v_hash, k.corrida_id, p_caso, v_contenido, length(v_contenido::text));

  update forense.casos set estado = 'ronda1' where id = p_caso and estado = 'en_cola';
  update forense.clusters set estado = 'ronda1' where id = k.cluster_id and estado = 'pendiente';

  perform forense.log(p_caso, 'sistema', 'ronda_inicio',
    jsonb_build_object('ronda', 1, 'context_hash', v_hash,
                       'n_entidades', jsonb_array_length(v_contenido->'entidades'),
                       'bytes', length(v_contenido::text)),
    null, null, null, null, 1, k.cluster_id, null, k.corrida_id);

  return jsonb_build_object('ok', true, 'caso_id', p_caso, 'context_hash', v_hash,
                            'bytes', length(v_contenido::text),
                            'familias_evaluables', to_jsonb(v_fam),
                            'contenido', v_contenido);
end $$;


-- Fin 024_contexto_compacto.sql
