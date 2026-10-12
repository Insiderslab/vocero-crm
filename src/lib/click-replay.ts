/**
 * 009 (E6) — El primer clic antes de la hidratación.
 *
 * La página llega pintada desde el servidor y el botón ya SE VE, pero hasta
 * que el JavaScript carga y React hidrata nadie escucha: el clic se pierde
 * («Gestisci fasi», el acordeón del Laboratorio). Pasa sobre todo tras una
 * carga completa — y un prefetch `?_rsc=` fallido (E5) convierte la
 * navegación siguiente justo en eso.
 *
 * Este script va INLINE en el <head>, antes de cualquier JS de la app:
 * mientras React no ha hidratado, guarda el ÚLTIMO clic sobre un control sin
 * comportamiento nativo (botones fuera de formularios, role=button/switch/tab)
 * y lo frena para que nadie lo procese a medias. Al hidratar,
 * `window.__heiliHydrated()` lo repite una vez con `el.click()` si el
 * elemento sigue en la página y el clic tiene menos de 5 s. Enlaces y botones
 * de formulario no se tocan: esos ya funcionan sin JavaScript. Tampoco un
 * control nativo anidado dentro del botón, ni clics con otro botón del ratón
 * o con modificadores. Si a los 10 s no hubo hidratación, deja de frenar.
 */
export const CLICK_REPLAY_SCRIPT = `(function(){
  var pending = null, done = false, t0 = Date.now();
  var SEL = 'button:not([type=submit]):not([disabled]),[role=button],[role=switch],[role=tab]';
  var NATIVE = 'a[href],input,select,textarea,label,summary';
  function stop(){
    if (done) return;
    done = true;
    document.removeEventListener('click', onClick, true);
  }
  function onClick(e){
    if (done) return;
    // Sin hidratación en 10 s algo falló: se deja de frenar clics.
    if (Date.now() - t0 > 10000) { pending = null; stop(); return; }
    // Solo el clic principal y sin modificadores (abrir en pestaña, etc.).
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    var t = e.target && e.target.closest ? e.target.closest(SEL) : null;
    if (!t || t.closest('form')) return;
    // Un control nativo DENTRO del botón (enlace, campo, label…) ya funciona solo.
    var inner = e.target.closest(NATIVE);
    if (inner && inner !== t && t.contains(inner)) return;
    pending = { el: t, at: Date.now() };
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  document.addEventListener('click', onClick, true);
  setTimeout(function(){ if (!done) { pending = null; stop(); } }, 10000);
  window.__heiliHydrated = function(){
    if (done && !pending) { return; }
    var p = pending; pending = null;
    stop();
    if (p && p.el.isConnected && Date.now() - p.at < 5000) {
      setTimeout(function(){ p.el.click(); }, 0);
    }
  };
})();`;
