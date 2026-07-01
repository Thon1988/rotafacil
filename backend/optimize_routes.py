"""Google Maps route optimization + navigation helpers.

Endpoint:
    POST /api/optimize-google
        body: { stops: [{codigo, endereco, lat?, lon?}], origin?: {lat, lon} }
        returns: { stops: [...reordered...], distance_m, duration_s }

Uses Google Directions API with `waypoints=optimize:true` to reorder stops
along the shortest route. When lat/lon are missing, falls back to
geocoding-by-address via Google Geocoding API.
"""
from __future__ import annotations
import logging
import os
from typing import List, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger("optimize")

DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json"
GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"


async def reorder_with_google(
    stops: list,
    origin: Optional[tuple] = None,
    api_key: Optional[str] = None,
) -> Optional[dict]:
    """Reorder a list of stops (any object with .lat/.lon) using Google Directions
    waypoints=optimize:true. Returns dict {order: [orig_indices], distance_m, duration_s}
    or None if API unavailable or failed.

    Only considers stops with valid lat/lon. Max 25 waypoints (Google limit).
    """
    api_key = (api_key or os.environ.get("GOOGLE_MAPS_API_KEY", "")).strip()
    if not api_key:
        return None

    # Filter to stops with coordinates
    with_coords = [(i, s) for i, s in enumerate(stops)
                   if getattr(s, "lat", None) is not None and getattr(s, "lon", None) is not None]
    if len(with_coords) < 2:
        return None
    if len(with_coords) > 25:
        # Google Directions limit is 25 waypoints incl. destination
        with_coords = with_coords[:25]

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            if origin is not None:
                orig_lat, orig_lon = origin
                waypoints = with_coords
            else:
                orig_lat, orig_lon = with_coords[0][1].lat, with_coords[0][1].lon
                waypoints = with_coords[1:]

            if not waypoints:
                return None

            destination = f"{waypoints[-1][1].lat},{waypoints[-1][1].lon}"
            mid = waypoints[:-1]
            wp_param = "optimize:true|" + "|".join(f"{w[1].lat},{w[1].lon}" for w in mid) if mid else ""

            params = {
                "origin": f"{orig_lat},{orig_lon}",
                "destination": destination,
                "key": api_key,
                "mode": "driving",
                "language": "pt-BR",
                "region": "br",
            }
            if wp_param:
                params["waypoints"] = wp_param

            r = await client.get(DIRECTIONS_URL, params=params)
            data = r.json()
            if data.get("status") != "OK" or not data.get("routes"):
                logger.warning(f"directions failed: {data.get('status')} {data.get('error_message', '')}")
                return None

            route = data["routes"][0]
            order = route.get("waypoint_order", [])

            # Rebuild order of ORIGINAL indices
            reordered_orig_indices: List[int] = []
            if origin is None:
                reordered_orig_indices.append(with_coords[0][0])  # origin was first stop
            for idx in order:
                reordered_orig_indices.append(mid[idx][0])
            reordered_orig_indices.append(waypoints[-1][0])

            distance_m = sum(leg.get("distance", {}).get("value", 0) for leg in route.get("legs", []))
            duration_s = sum(leg.get("duration", {}).get("value", 0) for leg in route.get("legs", []))

            return {
                "order": reordered_orig_indices,
                "distance_m": int(distance_m),
                "duration_s": int(duration_s),
            }
    except Exception as e:
        logger.warning(f"reorder_with_google failed: {e}")
        return None


class OptStop(BaseModel):
    codigo: str
    endereco: str
    lat: Optional[float] = None
    lon: Optional[float] = None


class OptOrigin(BaseModel):
    lat: float
    lon: float


class OptimizeIn(BaseModel):
    stops: List[OptStop] = Field(..., min_length=2, max_length=25)
    origin: Optional[OptOrigin] = None  # default: first stop as origin


class OptimizeOut(BaseModel):
    stops: List[OptStop]
    distance_m: int = 0
    duration_s: int = 0
    used_google: bool = True


async def _geocode(client: httpx.AsyncClient, addr: str, api_key: str) -> Optional[tuple]:
    try:
        r = await client.get(GEOCODE_URL, params={"address": addr, "key": api_key, "region": "br"})
        data = r.json()
        if data.get("status") == "OK" and data.get("results"):
            loc = data["results"][0]["geometry"]["location"]
            return float(loc["lat"]), float(loc["lng"])
    except Exception as e:
        logger.warning(f"geocode failed for '{addr[:40]}': {e}")
    return None


def register_optimize_routes(api_router: APIRouter) -> None:
    @api_router.post("/optimize-google", response_model=OptimizeOut)
    async def optimize_google(payload: OptimizeIn):
        api_key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
        if not api_key:
            raise HTTPException(status_code=500, detail="google_maps_api_key_missing")

        stops = [s.model_copy() for s in payload.stops]

        async with httpx.AsyncClient(timeout=15.0) as client:
            # 1) Ensure every stop has lat/lon
            for s in stops:
                if s.lat is None or s.lon is None:
                    coords = await _geocode(client, s.endereco, api_key)
                    if coords:
                        s.lat, s.lon = coords

            with_coords = [s for s in stops if s.lat is not None and s.lon is not None]
            no_coords = [s for s in stops if s.lat is None or s.lon is None]

            if len(with_coords) < 2:
                # Not enough geocoded stops → return as-is
                return OptimizeOut(stops=stops, used_google=False)

            # 2) Origin: user-provided or first stop
            if payload.origin:
                orig_lat, orig_lon = payload.origin.lat, payload.origin.lon
                waypoints = with_coords
            else:
                orig_lat, orig_lon = with_coords[0].lat, with_coords[0].lon
                waypoints = with_coords[1:]

            if not waypoints:
                return OptimizeOut(stops=stops, used_google=False)

            destination = f"{waypoints[-1].lat},{waypoints[-1].lon}"
            mid = waypoints[:-1]
            wp_param = "optimize:true|" + "|".join(f"{w.lat},{w.lon}" for w in mid) if mid else ""

            params = {
                "origin": f"{orig_lat},{orig_lon}",
                "destination": destination,
                "key": api_key,
                "mode": "driving",
                "language": "pt-BR",
                "region": "br",
            }
            if wp_param:
                params["waypoints"] = wp_param

            r = await client.get(DIRECTIONS_URL, params=params)
            data = r.json()
            if data.get("status") != "OK" or not data.get("routes"):
                logger.warning(f"directions failed: {data.get('status')} {data.get('error_message', '')}")
                return OptimizeOut(stops=stops, used_google=False)

            route = data["routes"][0]
            order = route.get("waypoint_order", [])

            # Rebuild in optimized order: origin → optimized_waypoints → destination
            reordered: List[OptStop] = []
            if not payload.origin:
                reordered.append(with_coords[0])  # origin was first stop
            for idx in order:
                reordered.append(mid[idx])
            reordered.append(waypoints[-1])
            reordered.extend(no_coords)  # tail: any stop we could not geocode

            distance_m = sum(leg.get("distance", {}).get("value", 0) for leg in route.get("legs", []))
            duration_s = sum(leg.get("duration", {}).get("value", 0) for leg in route.get("legs", []))

            return OptimizeOut(
                stops=reordered,
                distance_m=distance_m,
                duration_s=duration_s,
                used_google=True,
            )
