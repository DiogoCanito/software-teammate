// mobile-sidebar.js — shared mobile sidebar toggle
(function () {
  function init() {
    const btn     = document.getElementById('mobile-menu-btn');
    const overlay = document.getElementById('sidebar-overlay');
    const sidebar = document.querySelector('.sidebar');
    if (!btn || !overlay || !sidebar) return;

    function openSidebar() {
      sidebar.classList.add('open');
      overlay.classList.add('open');
      btn.classList.add('open');
    }
    function closeSidebar() {
      sidebar.classList.remove('open');
      overlay.classList.remove('open');
      btn.classList.remove('open');
    }

    btn.addEventListener('click', () => {
      sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
    });
    overlay.addEventListener('click', closeSidebar);

    // Close when a nav link is clicked (navigating away)
    sidebar.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', closeSidebar);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// Shared mobile toast helper
function showMobileToast(msg, icon) {
  icon = icon || 'ℹ';
  let toast = document.getElementById('mobile-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'mobile-toast';
    toast.className = 'mobile-toast';
    toast.innerHTML = '<span class="mobile-toast-icon"></span><span class="mobile-toast-msg"></span>';
    document.body.appendChild(toast);
  }
  toast.querySelector('.mobile-toast-icon').textContent = icon;
  toast.querySelector('.mobile-toast-msg').textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
}
