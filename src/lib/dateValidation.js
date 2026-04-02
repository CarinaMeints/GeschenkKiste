function isValidDayMonth(day, month, { allowFeb29 = true } = {}) {
  const d = Number(day);
  const m = Number(month);

  if (!Number.isInteger(d) || !Number.isInteger(m)) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1) return false;

  if (m === 2) return d <= (allowFeb29 ? 29 : 28);

  if ([4, 6, 9, 11].includes(m)) return d <= 30;

  return d <= 31;
}

module.exports = { isValidDayMonth };
