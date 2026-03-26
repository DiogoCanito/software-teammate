// Loads dynamic counts into sidebar nav badges.
// Runs after DOMContentLoaded so the page's `sb` client is already defined.
document.addEventListener('DOMContentLoaded', async () => {
  if (typeof sb === 'undefined') return;
  try {
    const [
      { count: tasksCount },
      { count: projsCount },
      { count: propostasCount },
    ] = await Promise.all([
      sb.from('tasks').select('*', { count: 'exact', head: true }).neq('status', 'concluida'),
      sb.from('projects').select('*', { count: 'exact', head: true }).neq('phase', 'cancelado'),
      sb.from('propostas').select('*', { count: 'exact', head: true }).in('estado', ['enviada', 'em-negociacao']),
    ]);

    const tEl = document.getElementById('nav-badge-tarefas');
    const pEl = document.getElementById('nav-badge-projetos');
    const rEl = document.getElementById('nav-badge-propostas');

    if (tEl) tEl.textContent = tasksCount ?? 0;
    if (pEl) pEl.textContent = projsCount ?? 0;
    if (rEl) {
      const cnt = propostasCount ?? 0;
      rEl.textContent = cnt;
      rEl.style.display = cnt > 0 ? '' : 'none';
    }
  } catch (e) {
    console.error('Erro ao carregar nav badges:', e);
  }
});
