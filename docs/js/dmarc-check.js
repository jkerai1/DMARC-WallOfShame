/**
 * DMARC check tool page: terminal-themed UI that queries Cloudflare’s DNS-over-HTTPS API
 * for `_dmarc.<domain>` TXT, parses the record, and shows a verdict (reject / quarantine / none / missing).
 */
(() => {
  const $ = (id) => document.getElementById(id);

  /* ---------- Theme (same key as home page) ---------- */
  const themeBtn = $("themeBtn");
  const setTheme = (t) => {
    document.body.dataset.theme = t;
    themeBtn.textContent = t === "dark" ? "☀" : "◐";
    try {
      localStorage.setItem("cn_theme", t);
    } catch (e) {
      /* ignore */
    }
  };
  setTheme(localStorage.getItem("cn_theme") || "dark");
  themeBtn.onclick = () => setTheme(document.body.dataset.theme === "dark" ? "light" : "dark");

  const termBody = $("termBody");

  /**
   * Appends a styled line to the fake terminal. Removes blink cursors from older lines unless `keepCursors`.
   * @param {string} html Safe-ish HTML for spans (classes pmt, ok, hl, mute, cursor, …).
   * @param {{ keepCursors?: boolean }} [opts]
   */
  function appendLine(html, opts = {}) {
    const span = document.createElement("span");
    span.className = "session-line";
    span.innerHTML = html;
    termBody.appendChild(span);
    if (!opts.keepCursors) {
      termBody.querySelectorAll(".session-line:not(:last-child) .cursor").forEach((n) => n.remove());
    }
    return span;
  }

  /** Promisified delay for typing animation and pacing. */
  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Types plain text of `html` char-by-char for effect, then restores full HTML (colors/spans).
   * @param {string} html
   * @param {number} [perChar] ms between characters
   */
  async function typeLine(html, perChar = 6) {
    const span = appendLine("");
    const tmp = document.createElement("span");
    tmp.innerHTML = html;
    const flat = tmp.textContent;
    for (let i = 1; i <= flat.length; i++) {
      span.textContent = flat.slice(0, i);
      await wait(perChar);
    }
    span.innerHTML = html;
  }

  /** Clears terminal, plays intro lines, then injects the domain form. */
  async function bootSequence() {
    termBody.innerHTML = "";
    appendLine('<span class="pmt">user@dmarc-shame</span> <span class="mute">~</span> $ <span class="cursor"></span>');
    await wait(500);
    await typeLine('<span class="pmt">user@dmarc-shame</span> <span class="mute">~</span> $ ./dmarc_check.sh');
    await wait(280);
    appendLine('<span class="ok">[ok]</span>  loading dmarc_check.sh v1.0.2 …');
    await wait(220);
    appendLine('<span class="ok">[ok]</span>  resolver: 1.1.1.1 (DoH) · timeout: 5s');
    await wait(220);
    appendLine('<span class="ok">[ok]</span>  ready · enter a domain to inspect <span class="cursor"></span>');
    await wait(150);
    renderForm();
  }

  /**
   * Builds the search form and quick-pick chips inside `#termBody`.
   * Submit normalizes URL-ish input to a bare domain and calls `runCheck`.
   */
  function renderForm() {
    const old = document.getElementById("checkForm");
    if (old) old.remove();
    const form = document.createElement("form");
    form.id = "checkForm";
    form.className = "check-form";
    form.innerHTML = `
      <span class="dollar">$</span>
      <input id="domainInput" type="text" placeholder="example.com" autocomplete="off" spellcheck="false" />
      <button type="submit" id="runBtn">run check</button>
    `;
    termBody.appendChild(form);
    const quick = document.createElement("div");
    quick.className = "quick";
    quick.innerHTML = `
      <span class="mute">try:</span>
      <button type="button" class="chip" data-d="google.com">google.com</button>
      <button type="button" class="chip" data-d="github.com">github.com</button>
      <button type="button" class="chip" data-d="bbc.co.uk">bbc.co.uk</button>
      <button type="button" class="chip" data-d="apache.org">apache.org</button>
    `;
    termBody.appendChild(quick);

    const input = document.getElementById("domainInput");
    setTimeout(() => input.focus(), 80);

    quick.querySelectorAll(".chip").forEach((c) => {
      c.onclick = () => {
        input.value = c.dataset.d;
        form.requestSubmit();
      };
    });

    form.onsubmit = (e) => {
      e.preventDefault();
      const v = (input.value || "")
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "");
      if (!v || !v.includes(".")) {
        appendLine('<span class="hl">[err]</span> please enter a valid domain (eg. example.com)');
        return;
      }
      runCheck(v);
    };
  }

  /** Disables inputs while a DNS lookup is in flight; updates button label. */
  function disableForm(disabled) {
    const inp = document.getElementById("domainInput");
    const btn = document.getElementById("runBtn");
    if (inp) inp.disabled = disabled;
    if (btn) {
      btn.disabled = disabled;
      btn.textContent = disabled ? "running …" : "run check";
    }
  }

  /**
   * Looks up `_dmarc.<domain>` TXT via Cloudflare public DoH (JSON API).
   * Picks the first answer whose stripped value starts with `v=dmarc1`.
   * @param {string} domain Normalized hostname.
   */
  async function runCheck(domain) {
    disableForm(true);

    appendLine(
      `<span class="pmt">user@dmarc-shame</span> <span class="mute">~</span> $ dig +short TXT _dmarc.${escapeHtml(domain)}`
    );
    await wait(380);
    appendLine('<span class="mute">; querying 1.1.1.1 …</span>');

    let record = null;
    let error = null;
    try {
      const url = `https://cloudflare-dns.com/dns-query?name=_dmarc.${encodeURIComponent(domain)}&type=TXT`;
      const r = await fetch(url, { headers: { accept: "application/dns-json" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (j.Answer && j.Answer.length) {
        for (const ans of j.Answer) {
          if (ans.type !== 16) continue;
          let txt = ans.data || "";
          txt = txt.replace(/" "/g, "").replace(/^"|"$/g, "");
          if (txt.toLowerCase().startsWith("v=dmarc1")) {
            record = txt;
            break;
          }
        }
      }
    } catch (e) {
      error = e;
    }

    await wait(380);

    if (error) {
      appendLine(`<span class="hl">[err]</span> resolver error: ${escapeHtml(error.message)}`);
      finishVerdict(
        domain,
        "bad",
        "Resolver error",
        `Couldn't reach the DNS resolver. This usually means a network or CORS hiccup — try again, or use <code>dig TXT _dmarc.${escapeHtml(domain)}</code> from a terminal.`,
        null,
        []
      );
      disableForm(false);
      return;
    }

    if (!record) {
      appendLine(
        '<span class="hl">[!!]</span> no TXT record found at <span class="hl">_dmarc.' +
          escapeHtml(domain) +
          "</span>"
      );
      finishVerdict(
        domain,
        "bad",
        "No DMARC record",
        `<b>${escapeHtml(domain)}</b> has no DMARC record published. Receiving servers have no policy to apply, and anyone can spoof mail from this domain. Spoofers love this.`,
        null,
        [
          { k: "v", v: "—", cls: "bad" },
          { k: "p", v: "—", cls: "bad" },
        ]
      );
      disableForm(false);
      return;
    }

    appendLine('<span class="ok">[ok]</span>  found record · parsing …');
    await wait(260);
    const tags = parseDmarc(record);
    appendLine(
      `<span class="ok">[ok]</span>  v=${escapeHtml(tags.v || "")} · p=<b>${escapeHtml(tags.p || "")}</b>` +
        (tags.sp ? ` · sp=${escapeHtml(tags.sp)}` : "") +
        (tags.pct ? ` · pct=${escapeHtml(tags.pct)}` : "")
    );

    let cls;
    let head;
    let msg;
    const p = (tags.p || "").toLowerCase();
    if (p === "reject") {
      cls = "ok";
      head = "Enforced · reject";
      msg = `<b>${escapeHtml(domain)}</b> rejects unauthenticated mail. This is the strongest DMARC posture and the right place to be. Nothing to fix from a wall-of-shame perspective.`;
    } else if (p === "quarantine") {
      cls = "warn";
      head = "Quarantine · partial enforcement";
      msg = `<b>${escapeHtml(domain)}</b> sends unauthenticated mail to spam, but doesn't reject it. Consider moving to <code>p=reject</code> once aggregate reports look clean.`;
    } else if (p === "none") {
      cls = "warn";
      head = "p=none · monitor only";
      msg = `<b>${escapeHtml(domain)}</b> publishes a DMARC record, but it's set to monitor only. Receivers are told nothing about how to handle spoofed mail. <span class="hl">This domain qualifies for the wall.</span> Move to <code>p=quarantine</code>, then <code>p=reject</code>.`;
    } else {
      cls = "warn";
      head = "Unrecognised policy";
      msg = `Couldn't parse the policy tag. The record was: <code>${escapeHtml(record)}</code>`;
    }
    finishVerdict(
      domain,
      cls,
      head,
      msg,
      record,
      [
        {
          k: "p",
          v: tags.p || "—",
          cls: p === "reject" ? "ok" : p ? "bad" : "bad",
        },
        tags.sp ? { k: "sp", v: tags.sp } : null,
        tags.pct ? { k: "pct", v: tags.pct } : null,
        tags.adkim ? { k: "adkim", v: tags.adkim } : null,
        tags.aspf ? { k: "aspf", v: tags.aspf } : null,
        tags.rua ? { k: "rua", v: shortAddr(tags.rua) } : null,
        tags.ruf ? { k: "ruf", v: shortAddr(tags.ruf) } : null,
      ].filter(Boolean)
    );
    disableForm(false);
  }

  /** Strips mailto: and trims RUA/RUF aggregate lists for chip display. */
  function shortAddr(s) {
    return String(s)
      .split(",")
      .map((x) => x.trim().replace(/^mailto:/i, ""))
      .join(", ");
  }

  /**
   * Split DMARC record on `;` into tag=value map (keys lowercased).
   * @param {string} record Raw TXT without outer quotes.
   * @returns {Record<string, string>}
   */
  function parseDmarc(record) {
    const out = {};
    record.split(";").forEach((part) => {
      const t = part.trim();
      if (!t) return;
      const eq = t.indexOf("=");
      if (eq < 0) return;
      const k = t.slice(0, eq).trim().toLowerCase();
      const v = t.slice(eq + 1).trim();
      out[k] = v;
    });
    return out;
  }

  /**
   * Removes any previous result blocks, then appends verdict panel, optional raw record,
   * tag chips, and actions (check again / back link).
   *
   * @param {string} domain
   * @param {string} cls CSS class: ok | warn | bad
   * @param {string} head Verdict title (escaped via escapeHtml in caller for domain inside msg only)
   * @param {string} msgHtml Body HTML (caller builds with escapeHtml where needed)
   * @param {string|null} record Full DMARC string or null
   * @param {Array<{ k: string, v: string, cls?: string }>} tags Key/value chips
   */
  function finishVerdict(domain, cls, head, msgHtml, record, tags) {
    document.querySelectorAll(".verdict, .record-box, .tags-row, .actions").forEach((n) => n.remove());

    const v = document.createElement("div");
    v.className = "verdict " + cls;
    v.innerHTML = `<h3>${escapeHtml(head)}</h3><p>${msgHtml}</p>`;
    termBody.appendChild(v);

    if (record) {
      const r = document.createElement("div");
      r.className = "record-box";
      r.innerHTML = `<div class="lab">_dmarc.${escapeHtml(domain)} · TXT</div><code>${escapeHtml(record)}</code>`;
      termBody.appendChild(r);
    }

    if (tags && tags.length) {
      const row = document.createElement("div");
      row.className = "tags-row";
      row.innerHTML = tags
        .map((t) => {
          const c = t.cls ? " " + t.cls : "";
          return `<span class="tag${c}">${escapeHtml(t.k)}=<b>${escapeHtml(t.v)}</b></span>`;
        })
        .join("");
      termBody.appendChild(row);
    }

    const a = document.createElement("div");
    a.className = "actions";
    a.innerHTML = `
      <button type="button" id="againBtn">↻ check another domain</button>
      <a href="index.html">◀ back to the wall</a>
    `;
    termBody.appendChild(a);
    document.getElementById("againBtn").onclick = () => {
      document.querySelectorAll(".verdict, .record-box, .tags-row, .actions").forEach((n) => n.remove());
      const inp = document.getElementById("domainInput");
      if (inp) {
        inp.value = "";
        inp.focus();
      }
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>\"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  bootSequence();
})();
