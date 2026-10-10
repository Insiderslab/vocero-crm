/**
 * 008 — Fragmento HTML + JS que el negocio pega en su sitio para mandar el
 * formulario de contacto/reservas a `/api/public/site-requests`. Puro (sin
 * DOM ni red): lo usa la pantalla de Configuración → Sitio web y lo prueban
 * los unit tests.
 *
 * JS en ES5 a propósito (`var`, sin flechas): el sitio del cliente puede ser
 * cualquier cosa, también un WordPress viejo sin transpilar.
 */

export type SnippetLabels = {
  name: string;
  phone: string;
  email: string;
  message: string;
  submit: string;
  thanks: string;
  error: string;
};

/** Escape para texto y atributos HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const LS = new RegExp("\\u2028", "g");
const PS = new RegExp("\\u2029", "g");

/** Literal de cadena JS seguro dentro de un <script> (sin cerrar la etiqueta). */
export function jsString(s: string): string {
  return JSON.stringify(s)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(LS, "\\u2028")
    .replace(PS, "\\u2029");
}

export function buildSiteSnippet(opts: {
  endpoint: string;
  /** Clave en claro (solo justo después de crearla) o un marcador. */
  siteKey: string;
  labels: SnippetLabels;
  formId?: string;
}): string {
  const { endpoint, siteKey, labels } = opts;
  const id = opts.formId ?? "heili-site-form";
  const h = escapeHtml;
  return `<form id="${h(id)}">
  <label>${h(labels.name)}<br><input name="name" required maxlength="120" autocomplete="name"></label><br>
  <label>${h(labels.phone)}<br><input name="phone" type="tel" required maxlength="40" autocomplete="tel" placeholder="+58 412 1234567"></label><br>
  <label>${h(labels.email)}<br><input name="email" type="email" maxlength="254" autocomplete="email"></label><br>
  <label>${h(labels.message)}<br><textarea name="message" required maxlength="4000" rows="4"></textarea></label><br>
  <!-- Campi extra (es. data, persone): <input name="data"> o <input name="fields[data]"> -->
  <!-- Trappola per i bot: non toglierla e non renderla visibile -->
  <div style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden" aria-hidden="true">
    <label>Website<input name="website" tabindex="-1" autocomplete="off"></label>
  </div>
  <button type="submit">${h(labels.submit)}</button>
  <p data-esito role="status"></p>
</form>
<script>
(function () {
  var ENDPOINT = ${jsString(endpoint)};
  var KEY = ${jsString(siteKey)};
  var THANKS = ${jsString(labels.thanks)};
  var ERROR = ${jsString(labels.error)};
  var KNOWN = { name: 1, phone: 1, email: 1, message: 1, website: 1 };
  var form = document.getElementById(${jsString(id)});
  if (!form) return;
  var out = form.querySelector("[data-esito]");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var data = new FormData(form);
    var body = { fields: {} };
    data.forEach(function (value, name) {
      if (typeof value !== "string") return;
      var m = /^fields\\[(.+)\\]$/.exec(name);
      // Campos propios del sitio (fields[x] o cualquier otro name) van a «fields».
      if (m || !KNOWN[name]) { if (value.trim()) body.fields[m ? m[1] : name] = value; }
      else body[name] = value;
    });
    body.pageUrl = location.href;
    if (document.documentElement.lang) body.locale = document.documentElement.lang;
    var button = form.querySelector("button[type=submit]");
    if (button) button.disabled = true;
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Site-Key": KEY },
      body: JSON.stringify(body)
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (json) {
          if (res.ok) { form.reset(); out.textContent = THANKS; }
          else if (res.status === 422 && json.error && json.error.message) { out.textContent = json.error.message; }
          else { out.textContent = ERROR; }
        });
      })
      .catch(function () { out.textContent = ERROR; })
      .then(function () { if (button) button.disabled = false; });
  });
})();
</script>`;
}
