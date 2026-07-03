"""
OR-Tools based TSP optimizer for the delivery route.

Circuit / Routific / similar platforms use CP-SAT + guided local search
solvers (like OR-Tools) rather than nearest-neighbor. This module gives
us Circuit-grade routing quality with zero API cost.

Strategy:
  - Build an N×N distance matrix.
    * ≤ 25 stops → use Google Distance Matrix (real driving distances).
    * > 25 stops → use haversine × 1.3 (urban driving factor). This is
      fast, free, and produces near-optimal orderings when the network
      is roughly grid-like (like São Paulo).
  - Feed the matrix into OR-Tools RoutingModel.
  - Solver: PATH_CHEAPEST_ARC + GUIDED_LOCAL_SEARCH for ≤ 60 seconds
    (usually converges in < 2 s for ≤ 100 stops).
"""
from __future__ import annotations

import math
import os
from typing import List, Optional, Tuple

import httpx
from ortools.constraint_solver import pywrapcp, routing_enums_pb2


EARTH_RADIUS_KM = 6371.0
URBAN_FACTOR = 1.3  # straight-line → typical urban driving distance
DEFAULT_SPEED_KMH = 30.0


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    if lat1 == lat2 and lon1 == lon2:
        return 0.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return EARTH_RADIUS_KM * c


def _build_haversine_matrix(points: List[Tuple[float, float]]) -> List[List[int]]:
    """Distance matrix in METERS (int) — OR-Tools needs int cost."""
    n = len(points)
    matrix = [[0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            d_km = _haversine_km(points[i][0], points[i][1], points[j][0], points[j][1]) * URBAN_FACTOR
            d_m = int(round(d_km * 1000))
            matrix[i][j] = d_m
            matrix[j][i] = d_m
    return matrix


async def _build_google_distance_matrix(
    points: List[Tuple[float, float]], api_key: str
) -> Optional[Tuple[List[List[int]], List[List[int]]]]:
    """Call Google Routes API v2 matrix endpoint. Returns (dist_m, dur_s) or None on failure.
    Batches into ≤25×25 sub-matrices to stay within API limits.
    """
    n = len(points)
    if n == 0 or not api_key:
        return None
    url = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": "originIndex,destinationIndex,distanceMeters,duration,status",
    }
    dist_m = [[0] * n for _ in range(n)]
    dur_s = [[0] * n for _ in range(n)]
    BATCH = 25  # Routes API v2 max: 25 origins × 25 destinations = 625 elements

    def _wp(pt):
        return {
            "waypoint": {
                "location": {"latLng": {"latitude": pt[0], "longitude": pt[1]}}
            }
        }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            for i0 in range(0, n, BATCH):
                for j0 in range(0, n, BATCH):
                    origins = points[i0:i0 + BATCH]
                    dests = points[j0:j0 + BATCH]
                    body = {
                        "origins": [_wp(p) for p in origins],
                        "destinations": [_wp(p) for p in dests],
                        "travelMode": "DRIVE",
                        "routingPreference": "TRAFFIC_UNAWARE",
                        "regionCode": "BR",
                        "languageCode": "pt-BR",
                    }
                    r = await client.post(url, json=body, headers=headers)
                    if r.status_code != 200:
                        return None
                    for item in r.json():
                        io = item.get("originIndex", 0) + i0
                        jo = item.get("destinationIndex", 0) + j0
                        d = item.get("distanceMeters", 0) or 0
                        dur_raw = item.get("duration", "0s")
                        try:
                            dur = int(str(dur_raw).rstrip("s"))
                        except ValueError:
                            dur = 0
                        dist_m[io][jo] = int(d)
                        dur_s[io][jo] = int(dur)
    except Exception:
        return None

    return dist_m, dur_s


def _solve_tsp(
    matrix: List[List[int]],
    start_index: int = 0,
    end_index: Optional[int] = None,
    time_limit_s: int = 8,
) -> Optional[List[int]]:
    """Solve open-TSP (start fixed, end fixed OR free). Return ordered indices or None."""
    n = len(matrix)
    if n <= 1:
        return list(range(n))

    if end_index is None:
        # Open TSP: add a virtual node that costs 0 to/from any real node so the
        # tour naturally terminates without a return trip.
        virtual = n
        ext_matrix = [row[:] + [0] for row in matrix] + [[0] * (n + 1)]
        manager = pywrapcp.RoutingIndexManager(n + 1, 1, [start_index], [virtual])
        routing = pywrapcp.RoutingModel(manager)

        def dist_cb(from_idx, to_idx):
            return ext_matrix[manager.IndexToNode(from_idx)][manager.IndexToNode(to_idx)]
    else:
        manager = pywrapcp.RoutingIndexManager(n, 1, [start_index], [end_index])
        routing = pywrapcp.RoutingModel(manager)

        def dist_cb(from_idx, to_idx):
            return matrix[manager.IndexToNode(from_idx)][manager.IndexToNode(to_idx)]

    transit_cb_idx = routing.RegisterTransitCallback(dist_cb)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_cb_idx)

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.seconds = max(1, min(60, time_limit_s))

    solution = routing.SolveWithParameters(params)
    if solution is None:
        return None

    order: List[int] = []
    idx = routing.Start(0)
    while not routing.IsEnd(idx):
        node = manager.IndexToNode(idx)
        if node < n:  # skip virtual node
            order.append(node)
        idx = solution.Value(routing.NextVar(idx))
    # Add end node if not already
    end_node = manager.IndexToNode(idx)
    if end_node < n and end_node not in order:
        order.append(end_node)
    return order


async def optimize_with_ortools(
    stops: list,
    start_lat: Optional[float] = None,
    start_lon: Optional[float] = None,
    return_to_start: bool = False,
    use_google_matrix: bool = False,
    fixed_first: Optional[int] = None,
    fixed_last: Optional[int] = None,
) -> Optional[dict]:
    """Reorder `stops` (list of Stop-like objects with .lat/.lon) with OR-Tools.

    Args:
        stops: list of pending stops with valid lat/lon.
        start_lat / start_lon: optional depot / start point. If provided, becomes
            the origin (index 0) with the first stop as start_index otherwise.
        return_to_start: currently unused (we do open TSP).
        use_google_matrix: if True, use Google Routes Matrix (real drive time).
            If False (default), use haversine × 1.3 — fast, free, works well.
        fixed_first: original index of the stop that MUST be first (for "Reotimizar").
        fixed_last: original index of the stop that MUST be last.

    Returns:
        {
          "order": [original_indices_reordered],
          "distance_m": int (matrix-based total),
          "duration_s": int (matrix-based total, may be 0 if no Google Matrix),
          "used_matrix": "google" | "haversine"
        } or None if it can't solve.
    """
    with_coords = [
        (i, s)
        for i, s in enumerate(stops)
        if getattr(s, "lat", None) is not None and getattr(s, "lon", None) is not None
    ]
    if len(with_coords) < 2:
        return None

    coords: List[Tuple[float, float]] = []
    orig_indices: List[int] = []
    if start_lat is not None and start_lon is not None:
        coords.append((start_lat, start_lon))
        orig_indices.append(-1)  # depot sentinel
    for i, s in with_coords:
        coords.append((float(s.lat), float(s.lon)))
        orig_indices.append(i)

    matrix: Optional[List[List[int]]] = None
    duration_matrix: Optional[List[List[int]]] = None
    used = "haversine"
    if use_google_matrix:
        api_key = (os.environ.get("GOOGLE_MAPS_API_KEY") or "").strip()
        if api_key:
            g = await _build_google_distance_matrix(coords, api_key)
            if g:
                matrix, duration_matrix = g
                used = "google"

    if matrix is None:
        matrix = _build_haversine_matrix(coords)

    # Determine start / end indices in the matrix (accounting for depot at 0)
    depot_offset = 1 if orig_indices and orig_indices[0] == -1 else 0
    start_idx = 0 if depot_offset else None

    if fixed_first is not None:
        # Map original stop index → matrix index
        try:
            mat_first = next(k for k, oi in enumerate(orig_indices) if oi == fixed_first)
        except StopIteration:
            mat_first = None
        if mat_first is not None:
            start_idx = mat_first

    end_idx: Optional[int] = None
    if fixed_last is not None:
        try:
            end_idx = next(k for k, oi in enumerate(orig_indices) if oi == fixed_last)
        except StopIteration:
            end_idx = None

    if start_idx is None:
        # Default: first pending stop is start
        start_idx = depot_offset

    order_matrix = _solve_tsp(matrix, start_index=start_idx, end_index=end_idx, time_limit_s=8)
    if not order_matrix:
        return None

    # Compute totals (skip depot)
    total_dist = 0
    total_dur = 0
    for k in range(len(order_matrix) - 1):
        a, b = order_matrix[k], order_matrix[k + 1]
        total_dist += matrix[a][b]
        if duration_matrix:
            total_dur += duration_matrix[a][b]

    if not duration_matrix:
        # Estimate duration from distance @ default urban speed
        total_dur = int((total_dist / 1000.0) / DEFAULT_SPEED_KMH * 3600.0)

    # Map back to original stop indices (drop depot -1 entries)
    original_order = [orig_indices[k] for k in order_matrix if orig_indices[k] != -1]

    return {
        "order": original_order,
        "distance_m": int(total_dist),
        "duration_s": int(total_dur),
        "used_matrix": used,
    }
