// Full-number identity. A 10-digit suffix match let UAE 971501234567 collide with BD 8801501234567.
export function normPhone(v: unknown): string {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length < 10) return "";
  if (d.length === 11 && d.startsWith("01")) return "880" + d.slice(1); // BD local 01XXXXXXXXX
  if (d.length === 10 && d.startsWith("1")) return "880" + d; // BD without the leading 0
  return d;
}
export const samePhone = (a: unknown, b: unknown) => {
  const x = normPhone(a);
  return x !== "" && x === normPhone(b);
};
