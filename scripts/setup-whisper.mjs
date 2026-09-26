import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve("vendor/whisper.cpp");
const binary = resolve(root, "build/bin/whisper-server");

try {
  await access(binary);
  process.stdout.write(`whisper-server is already available at ${binary}\n`);
  process.exit(0);
} catch {
  // Continue with the pinned source build.
}

await mkdir(resolve("vendor"), { recursive: true });
try {
  await access(root);
} catch {
  await run("git", ["clone", "--depth", "1", "--branch", "v1.9.4", "https://github.com/ggml-org/whisper.cpp.git", root]);
}
await run("cmake", ["-S", root, "-B", resolve(root, "build"), "-DWHISPER_BUILD_TESTS=OFF", "-DWHISPER_BUILD_EXAMPLES=ON", "-DCMAKE_BUILD_TYPE=Release"]);
await run("cmake", ["--build", resolve(root, "build"), "--target", "whisper-server", "--parallel"]);
process.stdout.write(`Built whisper-server at ${binary}\n`);

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, PATH: "/usr/local/bin:/usr/bin:/bin" },
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}
