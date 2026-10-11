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
 * de formulario no se tocan: esos ya funcionan sin JavaScript.
 */
export const CLICK_REPLAY_SCRIPT = `(function(){
  var pending = null, done = false;
  var SEL = 'button:not([type=submit]):not([disabled]),[role=button],[role=switch],[role=tab]';
  function onClick(e){
    if (done) return;
    var t = e.target && e.target.closest ? e.target.closest(SEL) : null;
    if (!t || t.closest('form')) return;
    pending = { el: t, at: Date.now() };
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  document.addEventListener('click', onClick, true);
  window.__heiliHydrated = function(){
    if (done) return;
    done = true;
    document.removeEventListener('click', onClick, true);
    var p = pending; pending = null;
    if (p && p.el.isConnected && Date.now() - p.at < 5000) {
      setTimeout(function(){ p.el.click(); }, 0);
    }
  };
})();`;
