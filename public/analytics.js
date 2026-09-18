/**
 * Google Analytics 4 — Sport Spectator
 *
 * One file, referenced from every page, so the measurement ID lives in
 * exactly one place. Loads gtag.js itself rather than needing a second
 * <script> tag on each page.
 */
(function () {
  var ID = 'G-EP3MNH243H';

  // Don't record the CMS as site traffic.
  if (location.pathname.indexOf('/admin') === 0) return;

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };

  gtag('js', new Date());
  gtag('config', ID);
})();
