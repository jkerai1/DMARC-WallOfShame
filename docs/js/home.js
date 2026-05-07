/**
 * Home page (index): theme toggle, decorative “terminal” intro, loads wall data,
 * builds filters, paginates the list, and exports CSV.
 */
(() => {
  /** @param {string} id */
  const $ = (id) => document.getElementById(id);

  /** Full dataset after fetch; each row may gain `.industry` from optional map. */
  let data = [];
  /** Subset after search/filter/sort; used for pagination and export. */
  let filtered = [];
  /** Rows per results page. */
  const PAGE = 100;

  /** UI state: search text, filters, sort key, current page. */
  const state = { q: "", status: "all", tld: "", industry: "", sort: "az", page: 1 };

  /* ---------- Dark / light theme (persisted) ---------- */
  const themeBtn = $("themeBtn");
  const setTheme = (t) => {
    document.body.dataset.theme = t;
    themeBtn.textContent = t === "dark" ? "☀" : "◐";
    try {
      localStorage.setItem("cn_theme", t);
    } catch (e) {
      /* storage unavailable */
    }
  };
  setTheme(localStorage.getItem("cn_theme") || "dark");
  themeBtn.onclick = () => setTheme(document.body.dataset.theme === "dark" ? "light" : "dark");

  /* ---------- Fake CLI session: timed lines for atmosphere ---------- */
  const sessionEl = $("session");
  const lines = [
    { txt: '<span class="pmt">$</span> ./audit.sh --scope global --policy missing,none', delay: 0 },
    { txt: '<span class="ok">[ok]</span> connecting to dns resolvers …', delay: 280 },
    { txt: '<span class="ok">[ok]</span> querying _dmarc.* TXT records', delay: 280 },
    { txt: '<span class="hl">[!!]</span> domains with no DMARC record detected', delay: 320 },
    { txt: '<span class="wn">[!]</span> domains with p=none policy detected', delay: 280 },
    { txt: '<span class="ok">[ok]</span> stream open · <span class="cursor"></span>', delay: 280, keepCursor: true },
  ];
  let i = 0;
  function nextLine() {
    if (i >= lines.length) return;
    const ln = document.createElement("span");
    ln.className = "ln";
    ln.innerHTML = lines[i].txt;
    sessionEl.appendChild(ln);
    sessionEl.querySelectorAll(".ln:not(:last-child) .cursor").forEach((n) => n.remove());
    i++;
    if (i < lines.length) setTimeout(nextLine, lines[i].delay);
  }
  setTimeout(nextLine, 200);

  (async () => {
    try {
      data = await window.fetchDmarcData();
    } catch (e) {
      $("list").innerHTML = '<div class="empty">connection error · retry</div>';
      return;
    }

    /**
     * Optional `window.__industryMap` from HTML can map domain → industry label.
     * @param {{ domain?: string }} d
     */
    function inferIndustry(d) {
      const u =
        window.__industryMap && window.__industryMap[(d.domain || "").toLowerCase()];
      if (u) return u;
      return "";
    }
    data.forEach((d) => {
      d.industry = inferIndustry(d);
    });

    /* Summary stats in the header */
    $("stTotal").textContent = data.length.toLocaleString();
    $("stNo").textContent = data.filter((d) => d.status === "no_dmarc").length.toLocaleString();
    $("stP").textContent = data.filter((d) => d.status === "p_none").length.toLocaleString();
    $("lastChecked").textContent = data[0] ? window.formatDate(data[0].last_checked) : "—";

    /* TLD dropdown: top 30 suffixes by count */
    const tldCounts = {};
    data.forEach((d) => {
      const t = window.tldOf(d.domain);
      tldCounts[t] = (tldCounts[t] || 0) + 1;
    });
    const tlds = Object.entries(tldCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30);
    const sel = $("tldSel");
    tlds.forEach(([t, n]) => {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = `${t}  (${n})`;
      sel.appendChild(o);
    });

    /* Industry dropdown from inferred labels + “unclassified” sentinel */
    const indCounts = {};
    data.forEach((d) => {
      if (d.industry) indCounts[d.industry] = (indCounts[d.industry] || 0) + 1;
    });
    const indSel = $("indSel");
    Object.entries(indCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([t, n]) => {
        const o = document.createElement("option");
        o.value = t;
        o.textContent = `${t}  (${n})`;
        indSel.appendChild(o);
      });
    const oU = document.createElement("option");
    oU.value = "__unclassified__";
    oU.textContent = "(unclassified)";
    indSel.appendChild(oU);

    /**
     * Rebuilds `filtered` from `data` using `state`, then sorts in place.
     */
    function compute() {
      const q = state.q.trim().toLowerCase();
      filtered = data.filter((d) => {
        if (state.status !== "all" && d.status !== state.status) return false;
        if (state.tld && window.tldOf(d.domain) !== state.tld) return false;
        if (state.industry === "__unclassified__") {
          if (d.industry) return false;
        } else if (state.industry && d.industry !== state.industry) return false;
        if (!q) return true;
        return (
          (d.name || "").toLowerCase().includes(q) ||
          (d.domain || "").toLowerCase().includes(q) ||
          (d.industry || "").toLowerCase().includes(q)
        );
      });
      const ord = state.sort;
      filtered.sort((a, b) => {
        const an = (a.name || "").toLowerCase();
        const bn = (b.name || "").toLowerCase();
        if (ord === "az") return an.localeCompare(bn);
        if (ord === "za") return bn.localeCompare(an);
        if (ord === "tld")
          return window.tldOf(a.domain).localeCompare(window.tldOf(b.domain)) || an.localeCompare(bn);
        if (ord === "industry")
          return (a.industry || "\uffff").localeCompare(b.industry || "\uffff") || an.localeCompare(bn);
        if (ord === "status")
          return (a.status || "").localeCompare(b.status || "") || an.localeCompare(bn);
        return 0;
      });
    }

    /** Escapes text before inserting into HTML template literals. */
    function escapeHtml(s) {
      return String(s).replace(/[&<>\"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
      );
    }

    /**
     * Runs compute(), updates pager UI, renders current page of rows into `#list`.
     */
    function render() {
      compute();
      const total = filtered.length;
      const pages = Math.max(1, Math.ceil(total / PAGE));
      if (state.page > pages) state.page = pages;
      const start = (state.page - 1) * PAGE;
      const slice = filtered.slice(start, start + PAGE);
      $("resultCount").textContent = total.toLocaleString() + " match" + (total === 1 ? "" : "es");
      $("pageLabel").textContent = `page ${state.page} / ${pages}`;
      if (!slice.length) {
        $("list").innerHTML = '<div class="empty">// no matches</div>';
        return;
      }
      $("list").innerHTML = slice
        .map((d) => {
          const cls = d.status === "no_dmarc" ? "no" : "pn";
          const indCls = d.industry ? "" : "empty";
          return `<div class="row">
        <div class="nm">${escapeHtml(d.name || "")}</div>
        <div class="dm">${escapeHtml(d.domain || "")}</div>
        <div class="tld">${window.tldOf(d.domain)}</div>
        <div class="ind ${indCls}">${escapeHtml(d.industry || "")}</div>
        <div><span class="st ${cls}">${cls === "no" ? "NO RECORD" : "p=none"}</span></div>
        <div class="ts">${window.formatDate(d.last_checked)}</div>
      </div>`;
        })
        .join("");
    }

    /* Collapsible filter panel + badge when non-default filters active */
    const ctl = $("controls");
    const ftog = $("filterToggle");
    ftog.onclick = () => {
      const open = ctl.classList.toggle("open");
      ftog.setAttribute("aria-expanded", open ? "true" : "false");
    };
    function updateFilterBadge() {
      const active = state.status !== "all" || state.tld || state.industry || state.sort !== "az";
      ftog.classList.toggle("active", !!active);
    }

    $("q").addEventListener("input", (e) => {
      state.q = e.target.value;
      state.page = 1;
      render();
    });
    document.querySelectorAll("#statusSeg button").forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll("#statusSeg button").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        state.status = b.dataset.v;
        state.page = 1;
        render();
        updateFilterBadge();
      };
    });
    $("tldSel").onchange = (e) => {
      state.tld = e.target.value;
      state.page = 1;
      render();
      updateFilterBadge();
    };
    $("indSel").onchange = (e) => {
      state.industry = e.target.value;
      state.page = 1;
      render();
      updateFilterBadge();
    };
    $("sortSel").onchange = (e) => {
      state.sort = e.target.value;
      render();
      updateFilterBadge();
    };
    $("prev").onclick = () => {
      state.page = Math.max(1, state.page - 1);
      render();
      window.scrollTo({ top: 0 });
    };
    $("next").onclick = () => {
      state.page = state.page + 1;
      render();
      window.scrollTo({ top: 0 });
    };

    /** Export all rows matching current filters as RFC-style CSV download. */
    $("exportBtn").onclick = () => {
      compute();
      const csvLines = ["name,domain,industry,status,tld,last_checked"];
      filtered.forEach((d) => {
        const cell = (s) => `"${String(s || "").replace(/"/g, '""')}"`;
        csvLines.push(
          [
            cell(d.name),
            cell(d.domain),
            cell(d.industry),
            cell(d.status),
            cell(window.tldOf(d.domain)),
            cell(d.last_checked),
          ].join(",")
        );
      });
      const blob = new Blob([csvLines.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "dmarc-shame.csv";
      a.click();
      URL.revokeObjectURL(url);
    };

    render();
  })();
})();
