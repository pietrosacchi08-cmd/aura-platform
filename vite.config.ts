import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

/**
 * Vite only exposes `VITE_`-prefixed variables to client code, but hosting
 * platforms and CI often inject the bare names. Copy the first non-empty
 * candidate into the `VITE_` name the app reads. Absent everywhere → empty
 * string, which keeps AURA in local (localStorage) mode.
 */
function resolveSupabaseEnv(mode: string) {
  const env = loadEnv(mode, process.cwd(), "");
  const pick = (...names: string[]): string => {
    for (const name of names) {
      const value = env[name] ?? process.env[name];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };
  return {
    url: pick("VITE_SUPABASE_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "PUBLIC_SUPABASE_URL"),
    anonKey: pick(
      "VITE_SUPABASE_ANON_KEY",
      "SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_KEY",
    ),
  };
}

export default defineConfig(({ mode }) => {
  const supabase = resolveSupabaseEnv(mode);
  return {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabase.url),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(supabase.anonKey),
    },
    server: {
      port: 3000,
      host: true,
      // The site is reverse-proxied behind <label>.<PUBLIC_SITE_DOMAIN>; the proxy
      // masks the Host to localhost:3000, but accept any host so a dev server never
      // rejects a proxied request with "Blocked request".
      allowedHosts: true,
    },
    plugins: [
      tailwindcss(),
      tsConfigPaths({
        projects: ["./tsconfig.json"],
      }),
      tanstackStart(),
      viteReact(),
    ],
  };
});
