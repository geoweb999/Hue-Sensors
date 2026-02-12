// Theme toggle — persists to localStorage, shared across pages
(function() {
  const saved = localStorage.getItem('hueTheme');
  if (saved === 'dark') {
    document.body.setAttribute('data-theme', 'dark');
  }

  document.addEventListener('DOMContentLoaded', function() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;

    btn.addEventListener('click', function() {
      const isDark = document.body.getAttribute('data-theme') === 'dark';
      if (isDark) {
        document.body.removeAttribute('data-theme');
        localStorage.setItem('hueTheme', 'light');
      } else {
        document.body.setAttribute('data-theme', 'dark');
        localStorage.setItem('hueTheme', 'dark');
      }
    });
  });
})();
