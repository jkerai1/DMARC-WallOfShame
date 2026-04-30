let rawData = [];
let currentSort = { key: "name", asc: true };

async function loadData() {
  const res = await fetch("non_dmarc.json");
  rawData = await res.json();

  updateStats();
  render();
}

function updateStats() {
  document.getElementById("total").textContent = rawData.length;

  const noDmarc = rawData.filter(d => d.status === "no_dmarc").length;
  const pNone = rawData.filter(d => d.status === "p_none").length;

  document.getElementById("no-dmarc-count").textContent = noDmarc;
  document.getElementById("pnone-count").textContent = pNone;
}

function getFilteredData() {
  const search = document.getElementById("search").value.toLowerCase();
  const filter = document.getElementById("filter").value;

  return rawData.filter(item => {
    const matchesSearch =
      item.name.toLowerCase().includes(search) ||
      item.domain.toLowerCase().includes(search);

    const matchesFilter =
      filter === "all" || item.status === filter;

    return matchesSearch && matchesFilter;
  });
}

function sortData(data) {
  return data.sort((a, b) => {
    let valA = a[currentSort.key];
    let valB = b[currentSort.key];

    if (currentSort.key === "last_checked") {
      valA = new Date(valA);
      valB = new Date(valB);
    }

    if (valA < valB) return currentSort.asc ? -1 : 1;
    if (valA > valB) return currentSort.asc ? 1 : -1;
    return 0;
  });
}

function render() {
  const table = document.getElementById("table-body");
  table.innerHTML = "";

  let data = getFilteredData();
  data = sortData(data);

  data.forEach(item => {
    const row = document.createElement("tr");

    const badge =
      item.status === "no_dmarc"
        ? `<span class="badge red">No DMARC</span>`
        : `<span class="badge yellow">p=none</span>`;

    row.innerHTML = `
      <td>${item.name}</td>
      <td>${item.domain}</td>
      <td>${badge}</td>
      <td>${new Date(item.last_checked).toLocaleString()}</td>
    `;

    table.appendChild(row);
  });
}

document.getElementById("search").addEventListener("input", render);
document.getElementById("filter").addEventListener("change", render);

document.querySelectorAll("th").forEach(header => {
  header.addEventListener("click", () => {
    const key = header.dataset.sort;

    if (!key) return;

    if (currentSort.key === key) {
      currentSort.asc = !currentSort.asc;
    } else {
      currentSort.key = key;
      currentSort.asc = true;
    }

    render();
  });
});

loadData();
