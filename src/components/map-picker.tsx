"use client";

import { useEffect, useRef, useState } from "react";

export function MapPicker({ lat, lng, onChange }: { lat: number; lng: number; onChange: (lat: number, lng: number) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<import("leaflet").Map | null>(null);
  const marker = useRef<import("leaflet").Marker | null>(null);
  const tileLayer = useRef<import("leaflet").TileLayer | null>(null);
  const [mapMode, setMapMode] = useState<"street" | "satellite">("street");
  const coordinates = useRef({ lat, lng });
  coordinates.current = { lat, lng };
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");

  function useCurrentLocation() {
    if (!navigator.geolocation) { setLocationError("Location is not supported by this browser."); return; }
    setLocationError(""); setLocating(true);
    navigator.geolocation.getCurrentPosition(
      position => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        marker.current?.setLatLng([point.lat, point.lng]);
        map.current?.setView([point.lat, point.lng], 17);
        onChangeRef.current(point.lat, point.lng);
        setLocating(false);
      },
      error => { setLocationError(error.message || "Could not read your current location."); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  useEffect(() => {
    let active = true;
    void import("leaflet").then(L => {
      if (!active || !element.current || map.current) return;
      const instance = L.map(element.current).setView([coordinates.current.lat, coordinates.current.lng], 14);
      tileLayer.current = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(instance);
      map.current = instance;
      marker.current = L.marker([coordinates.current.lat, coordinates.current.lng], {
        icon: L.divIcon({ className: "", html: '<div style="width:18px;height:18px;background:#147a59;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px #0005"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      }).addTo(instance);
      instance.on("click", event => {
        marker.current?.setLatLng(event.latlng);
        onChangeRef.current(event.latlng.lat, event.latlng.lng);
      });
    });
    return () => {
      active = false;
      map.current?.remove();
      map.current = null;
      marker.current = null;
      tileLayer.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current) return;
    if (tileLayer.current) map.current.removeLayer(tileLayer.current);
    void import("leaflet").then(L => {
      if (!map.current) return;
      tileLayer.current = mapMode === "satellite"
        ? L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: "Tiles © Esri", maxZoom: 19 })
        : L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 });
      tileLayer.current.addTo(map.current);
    });
  }, [mapMode]);

  useEffect(() => {
    if (!map.current || !marker.current) return;
    marker.current.setLatLng([lat, lng]);
    map.current.setView([lat, lng]);
  }, [lat, lng]);

  return <div className="relative">
    <div ref={element} className="map-picker" aria-label="Click to choose branch location" />
    <div className="absolute left-3 top-3 z-[500] flex rounded-lg bg-white p-1 shadow"><button type="button" onClick={() => setMapMode("street")} className={`rounded-md px-2.5 py-1.5 text-[10px] font-semibold ${mapMode === "street" ? "bg-black text-white" : "text-neutral-600"}`}>Map</button><button type="button" onClick={() => setMapMode("satellite")} className={`rounded-md px-2.5 py-1.5 text-[10px] font-semibold ${mapMode === "satellite" ? "bg-black text-white" : "text-neutral-600"}`}>Satellite</button></div>
    <button type="button" onClick={useCurrentLocation} disabled={locating} className="absolute right-3 top-3 z-[500] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold shadow disabled:opacity-60">{locating ? "Locating..." : "Use my location"}</button>
    {locationError && <p role="alert" className="mt-2 text-xs text-rose-600">{locationError}</p>}
  </div>;
}
