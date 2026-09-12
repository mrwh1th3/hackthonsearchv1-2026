import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (command, args) => spawnSync(command, args, {
  cwd: root, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'],
});

export function assess(config, facts) {
  const blockers = [];
  const pending = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { local_launch_ready: false, blockers: ['La configuración debe ser un objeto.'], pending };
  }
  if (config.schema_version !== 1) blockers.push('Versión de configuración no soportada.');
  if (config.hackathon_started !== true) blockers.push('Inicio del hackathon todavía no confirmado.');
  if (!facts.nodeOk) blockers.push('Se requiere Node 20 o posterior.');
  if (!facts.claudeOk) blockers.push('Claude Code no está disponible en PATH.');
  if (!facts.headOk) blockers.push('Falta commit inicial revisado; worktrees requieren HEAD.');
  if (!facts.kitCommitted) blockers.push('El kit tiene archivos sin commit; revisarlos antes de crear worktrees.');
  const dev = config.development ?? {};
  if (!Number.isInteger(dev.max_parallel_builders) || dev.max_parallel_builders < 1 || dev.max_parallel_builders > 4) {
    blockers.push('max_parallel_builders debe estar entre 1 y 4.');
  }
  if (!['opus', 'sonnet', 'haiku'].includes(dev.coordinator_model)) blockers.push('Alias de coordinador no permitido.');
  if (dev.allow_local_implementation !== true) blockers.push('Implementación local no autorizada en configuración.');
  if (!['pending', 'messages_api', 'claude_code_actions'].includes(config.runtime?.provider)) {
    blockers.push('Proveedor desconocido.');
  }
  if (config.runtime?.provider === 'pending') pending.push('Elegir proveedor tras auditar API o sistema Actions existente.');
  for (const field of ['n8n_url', 'n8n_version', 'supabase_project_ref', 'vercel_project', 'github_repo']) {
    if (!config.targets?.[field]) pending.push(`Confirmar destino: ${field}.`);
  }
  if (!config.reported_connections?.verified) pending.push('MCPs declarados, autenticación/destinos aún no verificados.');
  if (!config.authorizations?.remote_writes) pending.push('Escrituras remotas pendientes de autorización.');
  if (!config.authorizations?.outbound_phone_calls) pending.push('Llamadas reales deshabilitadas.');
  return { local_launch_ready: blockers.length === 0, blockers, pending };
}

export function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || !['--check', '--start'].includes(args[0])) {
    console.error('Uso: node scripts/launch.mjs --check | --start');
    return 2;
  }
  let config;
  try { config = JSON.parse(fs.readFileSync(path.join(root, 'launch.config.json'), 'utf8')); }
  catch { console.error('launch.config.json ausente o inválido; no se mostrará su contenido.'); return 2; }
  const kit = ['CLAUDE.md', 'ARRANQUE.md', 'launch.config.json', '.gitignore', 'scripts', '.claude/agents', '.claude/settings.json',
    ...fs.readdirSync(root).filter(n => /^\d\d-.*\.md$/.test(n))];
  const head = run('git', ['rev-parse', '--verify', 'HEAD']);
  const status = run('git', ['status', '--porcelain', '--untracked-files=all', '--', ...kit]);
  const claude = run('claude', ['--version']);
  const report = assess(config, {
    nodeOk: Number(process.versions.node.split('.')[0]) >= 20,
    claudeOk: claude.status === 0,
    headOk: head.status === 0,
    kitCommitted: status.status === 0 && status.stdout.trim() === '',
  });
  console.log(JSON.stringify({ ...report, network_checked: false, secrets_read: false }, null, 2));
  if (args[0] === '--check' || !report.local_launch_ready) return report.local_launch_ready ? 0 : 2;
  if (!process.stdin.isTTY) {
    console.error('El arranque requiere terminal interactiva; no se lanzará en segundo plano.');
    return 2;
  }
  const prompt = fs.readFileSync(path.join(root, 'ARRANQUE.md'), 'utf8');
  console.log('Iniciando Claude Code interactivo. Puede consumir la cuota de la cuenta activa.');
  const child = spawn('claude', ['--model', config.development.coordinator_model, '--permission-mode', 'default', prompt], {
    cwd: root, stdio: 'inherit', shell: false,
    env: { ...process.env, CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '1',
      CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: String(config.development.max_parallel_builders) },
  });
  child.on('error', () => { console.error('No se pudo iniciar Claude Code.'); process.exitCode = 2; });
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
