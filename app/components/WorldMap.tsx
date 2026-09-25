"use client";

import { useEffect, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { PeerDot } from "@/lib/types";
import { dotColor } from "@/lib/colors";
import { IconLocate } from "./icons";

// No fallback token: without one we show the "set NEXT_PUBLIC_MAPBOX_TOKEN"
// message below instead of silently loading a blank map.
const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

const SECONDS_PER_REVOLUTION = 180; // idle globe spin before you join
const LIVE_ZOOM = 4.2;

export default function WorldMap({
  peers,
  me,
  onPeerClick,
  canConnect,
}: {
  peers: PeerDot[];
  me: { lat: number; lng: number } | null;
  onPeerClick: (id: string) => void;
  canConnect: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const meMarkerRef = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);

  // Marker click handlers are bound once, so read the live click handler +
  // connectability through refs (synced in an effect, never during render).
  const onPeerClickRef = useRef(onPeerClick);
  const canConnectRef = useRef(canConnect);
  useEffect(() => {
    onPeerClickRef.current = onPeerClick;
    canConnectRef.current = canConnect;
  });

  // Initialise the map once: a globe with a faint emerald atmosphere.
  useEffect(() => {
    if (!TOKEN || !containerRef.current) return;
    let cancelled = false;
    const markers = markersRef.current;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled || !containerRef.current) return;
      mapboxgl.accessToken = TOKEN;
      const narrow = window.innerWidth < 640;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/dark-v11",
        projection: "globe",
        center: [-30, 25],
        zoom: narrow ? 0.9 : 1.6,
        attributionControl: false,
      });
      map.addControl(new mapboxgl.AttributionControl({ compact: true }));
      map.on("style.load", () => {
        map.setFog({
          color: "rgb(12, 14, 16)",
          "high-color": "rgb(16, 58, 46)",
          "horizon-blend": 0.06,
          "space-color": "rgb(9, 9, 11)",
          "star-intensity": 0.12,
        });
      });
      map.on("load", () => {
        if (!cancelled) setReady(true);
      });
      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      markers.forEach((m) => m.remove());
      markers.clear();
      meMarkerRef.current?.remove();
      meMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Before you join, slowly spin the globe. Stops for good once we know
  // where you are (the cleanup runs before the fly-to below).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || me) return;
    let spinning = true;

    const spin = () => {
      if (!spinning) return;
      const center = map.getCenter();
      center.lng -= 360 / SECONDS_PER_REVOLUTION;
      map.easeTo({ center, duration: 1000, easing: (n) => n });
    };
    const pause = () => (spinning = false);
    const resume = () => {
      spinning = true;
      spin();
    };

    map.on("moveend", spin);
    map.on("mousedown", pause);
    map.on("touchstart", pause);
    map.on("mouseup", resume);
    map.on("touchend", resume);
    spin();

    return () => {
      spinning = false;
      map.off("moveend", spin);
      map.off("mousedown", pause);
      map.off("touchstart", pause);
      map.off("mouseup", resume);
      map.off("touchend", resume);
      map.stop();
    };
  }, [ready, me]);

  // Show your own marker and fly the camera down to you when you join.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !me) return;
    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      if (!meMarkerRef.current) {
        const el = document.createElement("div");
        el.className = "pulse-me";
        el.title = "You are here (only you see this exact spot)";
        el.innerHTML = `<span class="pulse-me-label">You</span>`;
        meMarkerRef.current = new mapboxgl.Marker({ element: el })
          .setLngLat([me.lng, me.lat])
          .addTo(map);
        map.flyTo({
          center: [me.lng, me.lat],
          zoom: LIVE_ZOOM,
          duration: 3200,
          curve: 1.6,
          essential: true,
        });
      } else {
        meMarkerRef.current.setLngLat([me.lng, me.lat]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [me, ready]);

  // Reconcile markers whenever the peer list changes (or the map becomes ready).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      const markers = markersRef.current;
      const seen = new Set<string>();

      for (const peer of peers) {
        seen.add(peer.id);
        let marker = markers.get(peer.id);
        if (!marker) {
          const el = document.createElement("button");
          el.className = "pulse-dot";
          el.style.setProperty("--dot", dotColor(peer.id));
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            // Busy users would just auto-decline, so don't even ask.
            if (el.dataset.busy === "true") return;
            if (canConnectRef.current) onPeerClickRef.current(peer.id);
          });
          marker = new mapboxgl.Marker({ element: el })
            .setLngLat([peer.lng, peer.lat])
            .addTo(map);
          markers.set(peer.id, marker);
        }
        const el = marker.getElement();
        el.dataset.busy = String(peer.busy);
        const label = peer.busy ? "Stranger (in a chat)" : "Connect with stranger";
        el.title = label;
        el.setAttribute("aria-label", label);
      }

      // Drop markers for peers that went offline / got filtered out.
      for (const [id, marker] of markers) {
        if (!seen.has(id)) {
          marker.remove();
          markers.delete(id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [peers, ready]);

  function recenter() {
    const map = mapRef.current;
    if (!map || !me) return;
    map.flyTo({
      center: [me.lng, me.lat],
      zoom: Math.max(map.getZoom(), LIVE_ZOOM),
      duration: 1400,
      essential: true,
    });
  }

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full bg-zinc-950" />

      {!TOKEN && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="glass max-w-md rounded-2xl p-4 text-sm text-zinc-200">
            Set{" "}
            <code className="text-emerald-300">NEXT_PUBLIC_MAPBOX_TOKEN</code> in{" "}
            <code>.env</code> to load the map.
          </p>
        </div>
      )}

      {me && ready && (
        <button
          onClick={recenter}
          aria-label="Center on me"
          title="Center on me"
          className="glass btn absolute right-4 bottom-[calc(max(1rem,env(safe-area-inset-bottom))+2.75rem)] z-10 size-11 animate-glass-in text-zinc-200 hover:text-white"
        >
          <IconLocate />
        </button>
      )}
    </div>
  );
}
