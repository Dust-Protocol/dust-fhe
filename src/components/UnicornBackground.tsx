"use client";

import { useRef, useEffect, useState } from "react";

const SDK_URL = "/unicornStudio.umd.js";

declare global {
  interface Window {
    UnicornStudio?: {
      addScene(opts: Record<string, unknown>): Promise<{ destroy(): void }>;
    };
  }
}

interface Props {
  projectId: string;
  scale?: number;
  dpi?: number;
  fps?: number;
}

// Strip freeLogo layer and freePlan/includeLogo flags from embed response
// so the SDK never renders the watermark badge on the WebGL canvas
function patchFetch() {
  if (typeof window === "undefined") return;
  const key = "__us_fetch_patched";
  if ((window as unknown as Record<string, unknown>)[key]) return;
  (window as unknown as Record<string, unknown>)[key] = true;

  const original = window.fetch;
  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const response = await original.apply(this, args);
    const url = typeof args[0] === "string" ? args[0] : (args[0] as Request)?.url;
    if (url && (url.includes("unicorn.studio") || url.includes("unicornstudio"))) {
      const clone = response.clone();
      try {
        const json = await clone.json();
        if (json?.options) {
          json.options.freePlan = false;
          json.options.includeLogo = false;
        }
        // Remove the freeLogo WebGL layer that renders the watermark on canvas
        if (Array.isArray(json?.layers)) {
          json.layers = json.layers.filter((l: Record<string, unknown>) => l.type !== "freeLogo");
        }
        if (Array.isArray(json?.history)) {
          json.history = json.history.filter((l: Record<string, unknown>) => l.type !== "freeLogo");
        }
        return new Response(JSON.stringify(json), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch {
        return response;
      }
    }
    return response;
  };
}

export function UnicornBackground({ projectId, scale = 1, dpi = 1.5, fps = 60 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{ destroy(): void } | null>(null);
  const [sdkReady, setSdkReady] = useState(false);

  useEffect(() => {
    patchFetch();

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`);
    if (existing) {
      if (window.UnicornStudio?.addScene) setSdkReady(true);
      else existing.addEventListener("load", () => setSdkReady(true));
      return;
    }
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => setSdkReady(true);
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!sdkReady || !containerRef.current || !window.UnicornStudio?.addScene) return;

    const id = `us-bg-${Date.now()}`;
    containerRef.current.id = id;

    window.UnicornStudio
      .addScene({ elementId: id, projectId, scale, dpi, fps, production: true, lazyLoad: false })
      .then((scene) => { sceneRef.current = scene; })
      .catch(() => {});

    return () => {
      sceneRef.current?.destroy();
      sceneRef.current = null;
    };
  }, [sdkReady, projectId, scale, dpi, fps]);

  return <div ref={containerRef} className="absolute inset-0 w-full h-full" />;
}
