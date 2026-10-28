// 在畫面繪製前先套用主題，避免淺色使用者看到一瞬間的深色畫面。必須是同步載入的外部腳本（CSP 不允許 inline）。
(function () {
  var r = document.documentElement;
  try {
    var s = JSON.parse(localStorage.getItem('twm:v2') || '{}').settings || {};
    var theme = s.theme === 'light' || s.theme === 'dark' ? s.theme : matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    r.dataset.theme = theme;
    r.dataset.ud = s.ud === 'intl' ? 'intl' : 'tw';
  } catch (e) {
    r.dataset.theme = 'dark';
    r.dataset.ud = 'tw';
  }
})();
