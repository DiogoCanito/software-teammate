// auth.js — Guarda de autenticação partilhado entre todas as páginas protegidas
;(function () {
  // Esconde o conteúdo imediatamente para evitar flash de conteúdo protegido
  document.documentElement.style.visibility = 'hidden';

  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  sb.auth.getSession().then(function (res) {
    var session = res.data.session;
    if (!session) {
      window.location.replace('/login.html');
      return;
    }
    // Atualiza o nome do utilizador na sidebar
    var nameEl = document.getElementById('sidebar-user-name');
    if (nameEl) {
      var meta = session.user.user_metadata;
      nameEl.textContent = (meta && (meta.full_name || meta.name)) ||
        session.user.email.split('@')[0];
    }
    document.documentElement.style.visibility = '';
  });

  // Reage a mudanças de estado de autenticação (ex: sessão expirada)
  sb.auth.onAuthStateChange(function (_event, session) {
    if (!session) {
      window.location.replace('/login.html');
    }
  });

  // Logout com signOut do Supabase
  window.__authLogout = async function () {
    await sb.auth.signOut();
    window.location.replace('/login.html');
  };

  // Abre a confirmação de logout
  window.confirmLogout = function () {
    document.getElementById('__logout-overlay').style.display = 'flex';
  };

  // Injeta o overlay de confirmação de logout no DOM
  document.addEventListener('DOMContentLoaded', function () {
    var overlay = document.createElement('div');
    overlay.id = '__logout-overlay';
    overlay.className = '__logout-overlay';
    overlay.innerHTML =
      '<div class="__logout-card">' +
        '<div class="__logout-title">Terminar Sessão</div>' +
        '<div class="__logout-text">Tens a certeza que queres terminar a sessão atual?</div>' +
        '<div class="__logout-actions">' +
          '<button class="btn btn-ghost" onclick="document.getElementById(\'__logout-overlay\').style.display=\'none\'">Cancelar</button>' +
          '<button class="btn btn-primary" onclick="window.__authLogout()">Terminar Sessão</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
  });
})();
