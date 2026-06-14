import Script from "next/script";

export function RuntimeConfigScript() {
  return <Script id="errorwatch-runtime-config" src="/api/runtime-config" strategy="afterInteractive" />;
}
