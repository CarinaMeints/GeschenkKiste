function safeYear(y) {
  const n = Number(y);
  return Number.isFinite(n) ? n : 9999;
}

function safeStr(s) {
  return String(s || "");
}

function cmp(a, b) {
  return safeStr(a).localeCompare(safeStr(b), "de", { sensitivity: "base" });
}

function sortTasksChronologically(tasks = []) {
  return [...tasks].sort((a, b) => {
    const ya = safeYear(a?.year);
    const yb = safeYear(b?.year);
    if (ya !== yb) return ya - yb;

    const pa = a?.personOccasion?.person?.name || "";
    const pb = b?.personOccasion?.person?.name || "";
    const pc = cmp(pa, pb);
    if (pc !== 0) return pc;

    const oa = a?.personOccasion?.occasion?.name || "";
    const ob = b?.personOccasion?.occasion?.name || "";
    const oc = cmp(oa, ob);
    if (oc !== 0) return oc;

    const ca = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const cb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ca - cb;
  });
}

module.exports = { sortTasksChronologically };
