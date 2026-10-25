// Next.js runs register() once per server start. The NEXT_RUNTIME check must wrap the import directly so the
// Edge build drops Node-only modules (pg) entirely.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensurePart2 } = await import("./lib/part2");
    ensurePart2();
  }
}
