/**
 * DMARC check tool page: queries Cloudflare DNS-over-HTTPS for `_dmarc.<domain>` TXT,
 * parses the record, and shows a verdict.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const escapeHtml = window.escapeHtml;

  window.setupTheme("themeBtn");

  const form = $("checkForm");
  const input = $("domainInput");
  const runBtn = $("runBtn");
  const quickPicks = $("quickPicks");
  const resultArea = $("resultArea");
  const domainError = $("domainError");

  setTimeout(() => input.focus(), 80);

  quickPicks.onclick = (e) => {
    const chip = e.target.closest("button[data-d]");
    if (!chip) return;
    input.value = chip.dataset.d;
    form.requestSubmit();
  };

  form.onsubmit = (e) => {
    e.preventDefault();
    const domain = normalizeDomain(input.value);
    if (!domain) {
      showError("please enter a valid domain (eg. example.com)");
      return;
    }
    runCheck(domain);
  };

  function normalizeDomain(value) {
    const domain = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/[/?#].*$/, "")
      .replace(/:\d+$/, "");
    if (!domain || !domain.includes(".") || domain.includes(" ")) return "";
    return domain;
  }

  function disableForm(disabled) {
    input.disabled = disabled;
    runBtn.disabled = disabled;
    quickPicks.querySelectorAll("button").forEach((button) => {
      button.disabled = disabled;
    });
    runBtn.textContent = disabled ? "running ..." : "run check";
  }

  function showError(message) {
    input.setAttribute("aria-invalid", "true");
    domainError.textContent = message;
    resultArea.setAttribute("aria-busy", "false");
    resultArea.setAttribute("role", "alert");
    resultArea.innerHTML = `<span class="session-line"><span class="hl">[err]</span> ${escapeHtml(message)}</span>`;
  }

  function appendLine(html) {
    const span = document.createElement("span");
    span.className = "session-line";
    span.innerHTML = html;
    resultArea.appendChild(span);
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function runCheck(domain) {
    input.setAttribute("aria-invalid", "false");
    domainError.textContent = "";
    resultArea.setAttribute("role", "status");
    resultArea.setAttribute("aria-busy", "true");
    disableForm(true);
    resultArea.innerHTML = "";
    appendLine(
      `<span class="pmt">$</span> dig +short TXT _dmarc.${escapeHtml(domain)}`
    );
    appendLine('<span class="mute">; querying 1.1.1.1 ...</span>');

    let record = null;
    try {
      const lookup = fetchDmarcRecord(domain);
      if (!window.prefersReducedMotion()) await wait(500);
      record = await lookup;
    } catch (e) {
      appendLine(`<span class="hl">[err]</span> resolver error: ${escapeHtml(e.message)}`);
      finishVerdict(
        domain,
        "bad",
        "Resolver error",
        `Couldn't reach the DNS resolver. Try again, or use <code>dig TXT _dmarc.${escapeHtml(domain)}</code> from a terminal.`,
        null,
        []
      );
      disableForm(false);
      return;
    }

    if (!record) {
      appendLine(`<span class="hl">[!!]</span> no TXT record found at <span class="hl">_dmarc.${escapeHtml(domain)}</span>`);
      finishVerdict(
        domain,
        "bad",
        "No DMARC record",
        `<b>${escapeHtml(domain)}</b> has no DMARC record published. Receiving servers have no policy to apply, and anyone can spoof mail from this domain.`,
        null,
        [
          { k: "v", v: "-", cls: "bad" },
          { k: "p", v: "-", cls: "bad" },
        ]
      );
      disableForm(false);
      return;
    }

    appendLine('<span class="ok">[ok]</span> found record');
    const tags = parseDmarc(record);
    const p = (tags.p || "").toLowerCase();
    appendLine(
      `<span class="ok">[ok]</span> v=${escapeHtml(tags.v || "")} · p=<b>${escapeHtml(tags.p || "")}</b>` +
        (tags.sp ? ` · sp=${escapeHtml(tags.sp)}` : "") +
        (tags.pct ? ` · pct=${escapeHtml(tags.pct)}` : "")
    );

    const verdict = verdictForPolicy(domain, record, p);
    finishVerdict(domain, verdict.cls, verdict.head, verdict.msg, record, tagList(tags, p));
    disableForm(false);
  }

  async function fetchDmarcRecord(domain) {
    const url = `https://cloudflare-dns.com/dns-query?name=_dmarc.${encodeURIComponent(domain)}&type=TXT`;
    const r = await fetch(url, { headers: { accept: "application/dns-json" } });
    if (!r.ok) throw new Error("HTTP " + r.status);

    const j = await r.json();
    const answers = Array.isArray(j.Answer) ? j.Answer : [];
    for (const ans of answers) {
      if (ans.type !== 16) continue;
      const txt = String(ans.data || "")
        .replace(/"\s+"/g, "")
        .replace(/^"|"$/g, "");
      if (txt.toLowerCase().startsWith("v=dmarc1")) return txt;
    }
    return null;
  }

  function verdictForPolicy(domain, record, p) {
    if (p === "reject") {
      return {
        cls: "ok",
        head: "Enforced · reject",
        msg: `<b>${escapeHtml(domain)}</b> rejects unauthenticated mail. This is the strongest DMARC posture and the right place to be.`,
      };
    }
    if (p === "quarantine") {
      return {
        cls: "warn",
        head: "Quarantine · partial enforcement",
        msg: `<b>${escapeHtml(domain)}</b> sends unauthenticated mail to spam. Consider moving to <code>p=reject</code> once aggregate reports look clean.`,
      };
    }
    if (p === "none") {
      return {
        cls: "warn",
        head: "p=none · monitor only",
        msg: `<b>${escapeHtml(domain)}</b> publishes a DMARC record, but it is monitor only. <span class="hl">This domain qualifies for the wall.</span> Move to <code>p=quarantine</code>, then <code>p=reject</code>.`,
      };
    }
    return {
      cls: "warn",
      head: "Unrecognised policy",
      msg: `Couldn't parse the policy tag. The record was: <code>${escapeHtml(record)}</code>`,
    };
  }

  function tagList(tags, p) {
    const out = [{ k: "p", v: tags.p || "-", cls: p === "reject" ? "ok" : "bad" }];
    for (const key of ["sp", "pct", "adkim", "aspf"]) {
      if (tags[key]) out.push({ k: key, v: tags[key] });
    }
    if (tags.rua) out.push({ k: "rua", v: shortAddr(tags.rua) });
    if (tags.ruf) out.push({ k: "ruf", v: shortAddr(tags.ruf) });
    return out;
  }

  function shortAddr(s) {
    return String(s)
      .split(",")
      .map((x) => x.trim().replace(/^mailto:/i, ""))
      .join(", ");
  }

  function parseDmarc(record) {
    const out = {};
    for (const part of record.split(";")) {
      const t = part.trim();
      if (!t) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim().toLowerCase();
      out[k] = t.slice(eq + 1).trim();
    }
    return out;
  }

  function finishVerdict(domain, cls, head, msgHtml, record, tags) {
    const v = document.createElement("div");
    v.className = "verdict " + cls;
    v.setAttribute("role", "region");
    v.setAttribute("aria-labelledby", "verdictTitle");
    v.tabIndex = -1;
    v.innerHTML = `<h3 id="verdictTitle">${escapeHtml(head)}</h3><p>${msgHtml}</p>`;
    resultArea.appendChild(v);

    if (record) {
      const r = document.createElement("div");
      r.className = "record-box";
      r.innerHTML = `<div class="lab">_dmarc.${escapeHtml(domain)} · TXT</div><code>${escapeHtml(record)}</code>`;
      resultArea.appendChild(r);
    }

    if (tags.length) {
      const row = document.createElement("div");
      row.className = "tags-row";
      row.setAttribute("aria-label", "DMARC record tags");
      row.innerHTML = tags
        .map((t) => {
          const c = t.cls ? " " + t.cls : "";
          return `<span class="tag${c}">${escapeHtml(t.k)}=<b>${escapeHtml(t.v)}</b></span>`;
        })
        .join("");
      resultArea.appendChild(row);
    }

    const a = document.createElement("div");
    a.className = "actions";
    a.innerHTML = `
      <button type="button" id="againBtn">check another domain</button>
      <a href="index.html">back to the wall</a>
    `;
    resultArea.appendChild(a);
    $("againBtn").onclick = () => {
      resultArea.innerHTML = "";
      input.value = "";
      input.setAttribute("aria-invalid", "false");
      domainError.textContent = "";
      input.focus();
    };
    resultArea.setAttribute("aria-busy", "false");
    v.focus();
  }
})();
