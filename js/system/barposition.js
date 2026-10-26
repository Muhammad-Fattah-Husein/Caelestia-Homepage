(function () {
  var KEY = 'caelestia.barPosition';
  var VALID = ['left', 'right', 'top', 'bottom'];
  var DEFAULT = 'left';
  var mq = window.matchMedia('(min-width: 768px)'); // tablet & desktop
  var root = document.documentElement;

  function saved() {
    try {
      var v = localStorage.getItem(KEY);
      return VALID.indexOf(v) !== -1 ? v : DEFAULT;
    } catch (e) { return DEFAULT; }
  }

  var chosen = saved();

  // di HP, bar dipaksa kiri (pilihan tersimpan tidak hilang)
  function effective() { return mq.matches ? chosen : DEFAULT; }

    // sembunyikan pill yang semua isinya tersembunyi
  function tidyPills() {
    document.querySelectorAll('#bar .pill').forEach(function (p) {
      p.style.display = '';   // kembalikan ke aturan CSS dulu, baru ukur
      var visible = Array.prototype.some.call(p.children, function (c) {
        return c.getClientRects().length > 0;
      });
      if (!visible) p.style.display = 'none';
    });
  }

  function render() {
    root.dataset.bar = effective();
    if (mq.matches) root.setAttribute('data-bar-choosable', '');
    else root.removeAttribute('data-bar-choosable');

    document.querySelectorAll('[data-bar-pos]').forEach(function (b) {
      var on = b.dataset.barPos === chosen;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });

    tidyPills();
    
    window.dispatchEvent(new CustomEvent('barpositionchange', {
      detail: { position: effective() }
    }));
  }

  function set(pos) {
    if (VALID.indexOf(pos) === -1) return;
    chosen = pos;
    try { localStorage.setItem(KEY, pos); } catch (e) {}
    render();
  }

  // satu listener untuk semua tombol [data-bar-pos]
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-bar-pos]');
    if (btn) set(btn.dataset.barPos);
  });

  mq.addEventListener('change', render);

  window.addEventListener('resize', tidyPills);

  root.dataset.bar = effective();                    // langsung, sebelum halaman tergambar
  document.addEventListener('DOMContentLoaded', render);

  window.BarPosition = { set: set, get: effective, getSelected: function () { return chosen; } };
})();