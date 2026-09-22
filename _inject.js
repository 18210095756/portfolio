/* Test harness only — synthetic pointer sweep + diagnostics for headless verification. */
(function () {
  var RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var gotMouse = 0, gotPointer = 0, ptrErr = 'none';

  window.addEventListener('mousemove', function () { gotMouse++; }, true);
  window.addEventListener('pointermove', function () { gotPointer++; }, true);

  function send(type, x, y) {
    var opts = { clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 };
    window.dispatchEvent(new MouseEvent(type, opts));
    try { window.dispatchEvent(new PointerEvent(type, opts)); }
    catch (e) { ptrErr = e.message; }
  }

  function report() {
    var stage = document.getElementById('stage');
    var w = document.getElementById('warp');
    var t = document.getElementById('trail');
    var gl = null;
    try { gl = w && (w.getContext('webgl') || w.getContext('experimental-webgl')); } catch (e) {}

    var lit = -1, tw = 0, th = 0, err = '';
    try {
      var c2 = t.getContext('2d');
      tw = t.width; th = t.height;
      var d = c2.getImageData(0, 0, tw, th).data;
      lit = 0;
      for (var i = 3; i < d.length; i += 40) { if (d[i] > 6) lit++; }
    } catch (e) { err = e.message; }

    document.title = 'DIAG|warped=' + (stage && stage.classList.contains('is-warped')) +
      '|gl=' + (!!gl) + '|rm=' + RM +
      '|gotMouse=' + gotMouse + '|gotPointer=' + gotPointer + '|ptrErr=' + ptrErr +
      '|canvas=' + !!t + '|size=' + tw + 'x' + th +
      '|litPx=' + lit + (err ? '|err=' + err : '') +
      '|TDBG=' + (window.__tdbg ? window.__tdbg() : 'MISSING') +
      '|ERRS=' + ((window.__errs || []).join(' ~ ') || 'none');
  }

  window.addEventListener('load', function () {
    setTimeout(function () {
      send('pointerdown', 260, 560);
      var n = 0;
      var id = setInterval(function () {
        n++;
        var t = n / 42;
        send('pointermove', 250 + t * 1080, 470 + Math.sin(t * Math.PI * 1.5) * 230);
        if (n >= 42) { clearInterval(id); setTimeout(report, 20); }
      }, 30);
    }, 1200);
  });
})();
