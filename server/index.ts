import { createApp } from "./app.js";
const { app, auth, engine } = await createApp();
try {
  await app.listen({ port: 4310, host: "127.0.0.1" });
  console.log("\n  SHADOW · Personal assistant\n");
  console.log(`  Pair this PC: http://localhost:4310/pair#code=${auth.code}`);
  console.log(`  Pairing code: ${auth.code} (valid for 10 minutes)`);
  console.log(
    "  Phone access: Settings → Private phone access\n  Keep this terminal running. Press Ctrl+C to stop.\n",
  );
  void engine.pump();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
