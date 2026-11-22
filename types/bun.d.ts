/**
 * Tipizzazioni minime delle API Bun usate da `serve.ts` (production server).
 *
 * `bun-types` non è una dipendenza del progetto e non lo diventa: qui sono
 * dichiarati SOLO i simboli che serve.ts usa davvero. Sono dichiarazioni
 * puramente statiche — non emettono codice e non cambiano il runtime.
 */

/** Handle di un file Bun: i metodi usati più il corpo `Blob` di `Bun.file`. */
type BunFileHandle = Blob & {
  exists(): Promise<boolean>;
};

/** Comando di `Bun.$`: si concatena con `.quiet().nothrow()` e si attende. */
interface BunShellPromise extends Promise<unknown> {
  quiet(): BunShellPromise;
  nothrow(): BunShellPromise;
}

declare const Bun: {
  /** Shell integrata (usata per liberare la porta con sudo). */
  $: (strings: TemplateStringsArray, ...values: unknown[]) => BunShellPromise;
  /** File su disco, servito così com'è dai client assets. */
  file: (path: string) => BunFileHandle;
  /** Server HTTP: `fetch` riceve la Request standard del Web API. */
  serve: (options: {
    port: number;
    hostname?: string;
    fetch: (request: Request) => Response | Promise<Response>;
  }) => unknown;
  /** Attesa asincrona in millisecondi. */
  sleep: (ms: number) => Promise<void>;
};

interface ImportMeta {
  /** Directory del modulo corrente (specifico di Bun). */
  dir: string;
}
