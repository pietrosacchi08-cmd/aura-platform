/**
 * Formattazione degli importi per la UI — stile italiano, con separatore delle
 * migliaia: `formatEUR(2400) === "2.400,00"`.
 *
 * Il simbolo € lo aggiunge chi renderizza (`€ ${formatEUR(n)}`), così una card
 * può disporre simbolo e cifra separatamente. Qui non si arrotonda nulla: la
 * cifra è quella calcolata dai preventivi (round2), questo file la sola formatta.
 */
const eurFormatter = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  // L'italiano raggruppa solo da 5 cifre (2400 → "2400,00"): qui il separatore
  // delle migliaia serve sempre, quindi "2.400,00". `useGrouping: "always"` è
  // ES2023 e i tipi TS del progetto conoscono solo il boolean: il cast è solo
  // per il compilatore, Intl a runtime accetta la stringa.
  useGrouping: "always" as unknown as boolean,
});

/** "2.400,00" — importo senza simbolo, migliaia e decimali all'italiana. */
export function formatEUR(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  return eurFormatter.format(amount);
}

/** "€ 2.400,00" — simbolo + formato italiano. */
export function formatEuro(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  return `€ ${formatEUR(amount)}`;
}
