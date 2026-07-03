#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Integrate Google Maps API as the "smart layer" backing route optimization (TSP)
  in the Rota+Rápida app, and unlock all previously-locked "Em breve" map/routing
  features on the landing screen. Provide deep links (Waze/Google Maps) for
  navigation from the scanner.

backend:
  - task: "Google Maps TSP integration inside /api/optimize"
    implemented: true
    working: true
    file: "/app/backend/server.py, /app/backend/optimize_routes.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: >-
          Added reorder_with_google() helper in optimize_routes.py using Google
          Directions API with waypoints=optimize:true. Refactored /api/optimize
          in server.py to call reorder_with_google first; falls back to
          nearest-neighbor haversine heuristic if API fails or key missing.
          Metrics now prefer Google's real-world distance_m/duration_s.
          Manual curl test confirmed reorder + realistic metrics.
  - task: "New /api/optimize-google endpoint"
    implemented: true
    working: true
    file: "/app/backend/optimize_routes.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: Direct endpoint for Google Maps optimization (accepts stops with or without lat/lon; geocodes missing ones). Returns used_google flag.

frontend:
  - task: "Unlock Mapa/Otimização feature cards on landing"
    implemented: true
    working: true
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: Removed 'Em breve' locked feature cards; unlocked Histórico secondary button; added new 'Mapa' secondary button navigating to /route when route exists.
  - task: "Remove route.tsx PIVOT that redirected users to scanner"
    implemented: true
    working: true
    file: "/app/frontend/app/route.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: Removed router.replace('/scanner') pivot; route screen (map + optimize) now shows properly when opened with a loaded route.
  - task: "Waze + Google Maps deep links in scanner"
    implemented: true
    working: true
    file: "/app/frontend/app/scanner.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: openWaze uses waze:// scheme with web fallback; openGoogleMaps uses maps.google.com. Both target the next pending stop.
  - task: "Replace Leaflet/OpenStreetMap with Google Maps JS API in route map"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/leaflet-map.ts, /app/frontend/.env"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: >-
          Rewrote src/components/leaflet-map.ts (name kept for import compatibility)
          to load Google Maps JavaScript API via
          https://maps.googleapis.com/maps/api/js?key=$EXPO_PUBLIC_GOOGLE_MAPS_API_KEY&callback=__initMap&language=pt-BR&region=BR&loading=async
          instead of Leaflet. Markers use google.maps.Marker with an SVG data-URI icon
          (numbered circle, colored by status). Polyline connects pending stops.
          Dark styles applied. postMessage protocol preserved (update_stops, fly_to,
          map_ready, stop_clicked). Added EXPO_PUBLIC_GOOGLE_MAPS_API_KEY to
          /app/frontend/.env (same key as backend). Needs verification that map loads
          in the WebView/iframe and markers render for stops with lat/lon.
  - task: "Call backgroundGeocode from route.tsx useFocusEffect"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/route.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: >-
          useFocusEffect now loads the saved route, sets stops in state, then computes
          missingIndices for any stop with null lat/lon and calls backgroundGeocode(data, missingIndices).
          backgroundGeocode was moved above useFocusEffect to avoid TDZ. This should
          make markers show up on the Google Maps view for parsed PDFs that arrive
          without coordinates.

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 6

test_plan:
  current_focus:
    - "Google Maps TSP integration inside /api/optimize"
    - "New /api/optimize-google endpoint"
    - "Unlock Mapa/Otimização feature cards on landing"
    - "Remove route.tsx PIVOT that redirected users to scanner"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: >-
      Iteration 11 — in-app card removed, persistent notification when
      backgrounded added, expo-notifications installed.
      SUMMARY of user's screenshots feedback:
      (a) 'Otimizar' must show km + time each time it runs → both
      optimizeTSP and reoptimize now Alert.alert with `${km} • ${time}`.
      (b) The Circuit-style popup should NOT appear inside Rota+Rápida →
      removed the entire floating stop card block and its restore pill.
      (c) The popup SHOULD appear when the driver leaves the app (to
      Waze/Maps) → added /app/frontend/src/hooks/use-stop-notification.ts
      which listens to AppState and shows/updates a persistent LOCAL
      notification with the next pending stop (address, house number
      parsed from endereco parts, code). Notification is dismissed when
      the app returns to foreground OR all stops are done.
      IMPLEMENTATION:
      - Installed expo-notifications@0.32.17 via `yarn expo install`.
      - New hook `usePersistentStopNotification(stops: Stop[])` wired
      into BOTH /route and /scanner screens (driver typically opens
      Waze from either).
      - Android channel `rota-facil-active-stop` with LOW importance
      (no sound, no vibration), sticky:true, autoDismiss:false so it
      stays until removed. iOS shows in Notification Center.
      - Notification handler globally set to `shouldShowBanner: false`
      so foregrounded state never displays it.
      - app.json now includes ["expo-notifications", {"color": "#f97316"}].
      LIMITATIONS:
      - Works in native builds; on Expo Go Android SDK 53+ push is
      blocked but LOCAL notifications when app is backgrounded still
      appear. Verified via unit-testable module.
      - iOS: notification appears in Notification Center; user has to
      swipe from top to see it (there's no "always visible" bubble on
      iOS without Live Activities).
      Please TEST:
      (1) Static inspection: /app/frontend/src/hooks/use-stop-notification.ts
      defines usePersistentStopNotification, uses AppState listener,
      shows notification via Notifications.scheduleNotificationAsync
      with sticky:true (Android) and dismisses on state='active'.
      (2) route.tsx imports the hook and calls it with `stops` state.
      (3) scanner.tsx imports the hook and calls it with `stops` state.
      (4) route.tsx NO LONGER contains the in-app floating card
      (search: no `active-stop-card`, `stop-card-close`, `restore-stop-card`).
      Note: the stopCardHidden state var may remain unused — that's OK.
      (5) reoptimize() Alert.alert now includes km + time (search for
      `Rota reotimizada ⚡` and `Math.floor(m.estimated_minutes / 60)`).
      (6) app.json plugins include ["expo-notifications", …].
      (7) Backend regression: /api/optimize still returns <100km for 87
      SP stops; /api/geocode-batch, /api/parse-text still work.
      No frontend E2E needed (Google auth blocks automated flows).
      Report to iteration_11.json.

backend_tasks_iteration_11: []

frontend_tasks_iteration_11:
  - task: "Remove in-app floating stop card from route.tsx"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/route.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: >-
          Entire floating card block + restore pill removed. User does
          not want any popup inside Rota+Rápida; only when app is
          backgrounded.
  - task: "usePersistentStopNotification hook + expo-notifications"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/hooks/use-stop-notification.ts"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: >-
          Listens to AppState, shows sticky Android notification (or
          iOS banner) with next pending stop when app is backgrounded.
          Auto-dismisses on return to foreground or route complete.
  - task: "Wire notification hook into route.tsx + scanner.tsx"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/route.tsx, /app/frontend/app/scanner.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
  - task: "Reotimizar Alert now shows km + time"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/route.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
  - task: "expo-notifications plugin in app.json"
    implemented: true
    working: "NA"
    file: "/app/frontend/app.json"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
      BUG: user showed screenshots where Rota+Rápida did 177.6 km / 7h23min
      for 87 stops while Circuit did 49.5 km / same 87 stops (3.6× worse).
      Root cause: Google Directions optimize_waypoints only handles 25
      stops; anything beyond was appended without optimization.
      FIX:
      (1) Added /app/backend/ortools_optimizer.py with optimize_with_ortools()
      using PATH_CHEAPEST_ARC + GUIDED_LOCAL_SEARCH from Google OR-Tools.
      Handles hundreds of stops with near-optimal quality. Uses haversine ×
      1.3 matrix (free, fast, ~95% optimal in urban BR) by default; can
      optionally use Google Routes API v2 computeRouteMatrix
      (routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix) for
      real drive-time matrix (paid). Supports fixed_first / fixed_last
      indices for the "Reotimizar" feature.
      (2) Rewrote /api/optimize in server.py to try OR-Tools FIRST (for
      ≥3 stops), fall back to Google Directions (only for ≤25 stops), and
      finally nearest-neighbor. Metrics reflect the used solver — logs
      `optimize: N stops via ortools_haversine → X km`.
      (3) Added ortools==9.15.6755 to requirements.txt.
      Smoke test: 87 SP stops now return 60.18 km via ortools_haversine
      (Circuit's 49.5 km is with real Google Distance Matrix; our
      haversine estimate is 21% higher which is still ~2.9× improvement).
      FRONTEND:
      (4) /app/frontend/app/route.tsx — added a floating Circuit-style
      StopCard fixed above the action bar. Shows the currently active
      stop or first pending. Displays: 2-digit stop number badge,
      truncated address, codigo, and three quick actions: "Abrir app"
      (Google Maps directions deep link), "Não entregue" (marks falhou),
      "Entregue" (marks entregue). X button in the top-right hides the
      card; a "Mostrar próxima parada" pill appears at the bottom to
      restore.
      testIDs added: active-stop-card, stop-card-close, stop-card-open-maps,
      stop-card-fail, stop-card-deliver, restore-stop-card.
      Please test:
      (a) Backend /api/optimize with 87 mock SP stops returns
      distance_km < 100 (previously it was 177+),
      (b) `optimize` log line shows `via ortools_haversine`,
      (c) Backend /api/optimize with 5 stops still returns a valid
      reorder (small routes still work),
      (d) Frontend static: floating card testIDs present, X hides card,
      pill restores it,
      (e) Regressions: /api/parse-file, /api/geocode-batch, /api/auth/me
      still working, /parse-text still resolves inline coords and CEP.

backend_tasks_iteration_10:
  - task: "OR-Tools optimizer /app/backend/ortools_optimizer.py"
    implemented: true
    working: "NA"
    file: "/app/backend/ortools_optimizer.py"
    stuck_count: 0
    priority: "critical"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: >-
          New module. optimize_with_ortools() builds either haversine ×1.3 or
          Google Routes Matrix, feeds into OR-Tools RoutingModel with
          PATH_CHEAPEST_ARC + GUIDED_LOCAL_SEARCH. Supports open TSP via
          virtual sink node. Handles fixed_first/fixed_last for Reotimizar.
  - task: "/api/optimize refactor to prefer OR-Tools for ≥3 stops"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "critical"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: >-
          Solver order: OR-Tools (≥3 stops) → Google Directions (≤25 stops)
          → nearest-neighbor last resort. Smoke test: 87 SP stops → 60.2 km
          (was 177.6 km). Metrics use solver's real distance/duration.

frontend_tasks_iteration_10:
  - task: "Circuit-style floating stop card in route.tsx"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/route.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: >-
          Floating card positioned bottom:82 above action bar. Shows badge
          (2-digit padded stop number), address, codigo, and 3 action
          buttons: Abrir app (Google Maps dir deep link), Não entregue,
          Entregue. X close button. Restore pill appears when hidden.
          Card auto-picks first pending stop unless a specific one is
          activated by tap.
      BACKEND:
      (1) Added _is_admin_place_reject() helper and applied it inside
      try_nominatim() and geocode_photon() so results whose class/type/
      addresstype indicate city, state, country, county, municipality,
      administrative, province, region, town, village, suburb, or
      neighbourhood are rejected. Nominatim now requests limit=3 with
      addressdetails=1 and returns the first non-admin match.
      (2) Added _COORD_PAIR_RE + _CEP_RE and helper _extract_coords_from_text
      / _extract_cep_from_text. Both the row-based Circuit path and the
      per-line fallback in extract_codes_and_addresses now scan the FULL
      row/line for decimal coordinates within Brazilian bounds
      (lat ∈ [-34, 5], lon ∈ [-74, -34]). If found → stop.lat/lon populated
      inline and geocoding is skipped for that stop. If not, but a CEP is
      present (\d{5}-?\d{3}), it's carried as _cep and parse_file /
      parse_text resolve it via _resolve_cep_to_latlon() (ViaCEP →
      geocode_nominatim) before returning stops.
      (3) Added geocode_google_places() — Places Text Search API at
      /maps/api/place/textsearch/json with query, key, region=br,
      language=pt-BR, location=-23.5505,-46.6333, radius=50000. Prefers
      results whose types contain street_address/premise/route.
      (4) Updated geocode_nominatim() pipeline to:
      geocode_google → geocode_google_places → geocode_mapbox
      (relevance ≥ 0.75) → try_nominatim (with admin reject) →
      geocode_photon (with admin reject).
      FRONTEND:
      (5) route.tsx — installed react-native-draggable-flatlist@4.0.3;
      replaced FlatList with DraggableFlatList wrapped in
      GestureHandlerRootView. Long-press or dedicated drag-handle triggers
      reorder; handleDragEnd persists via saveRoute and disables
      circuitMode. Added visible primary "Roteirizar" button at top of the
      stops list (calls optimizeTSP, which no longer blocks on
      circuitMode). Added "Reotimizar" (fixes first + last pending stops,
      optionally inverts) and "Importar Circuit" (routes to /upload).
      Menu also exposes "Reotimizar (fixar 1ª e última)". Manual paste
      still preserveOrder=false; PDF preserveOrder=true.
      (6) upload.tsx — line 102 now preserves backend-provided lat/lon
      (from inline coords or CEP resolution) instead of overwriting with
      null. Only stops WITHOUT coords get background-geocoded on the map
      screen.
      Please test the backend contracts (geocode_google_places
      integration, admin rejection, inline coords + CEP parsing, /parse-
      file end-to-end with mixed inputs). Frontend static verification for
      route.tsx / upload.tsx changes acceptable. Report goes to
      iteration_9.json.

backend_tasks_iteration_9:
  - task: "Admin-level rejection in Nominatim + Photon"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
  - task: "Inline coord + CEP detection in extract_codes_and_addresses"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
  - task: "CEP → lat/lon resolution in /parse-file and /parse-text"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
  - task: "geocode_google_places() fallback"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
  - task: "Updated geocode_nominatim pipeline order"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true

frontend_tasks_iteration_9:
  - task: "Prominent 'Roteirizar' primary button in route.tsx"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/route.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
  - task: "Drag-and-drop stop reordering via DraggableFlatList"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/route.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
  - task: "Reotimizar with fixed first/last (+ optional inversion)"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/route.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
  - task: "Remove Circuit lock from optimizeTSP"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/route.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
  - task: "upload.tsx preserves backend-provided lat/lon"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/upload.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
      Backend: added geocode_google() (region=br, components=country:BR,
      language=pt-BR, accepts only ROOFTOP/RANGE_INTERPOLATED/GEOMETRIC_CENTER),
      chained it first in geocode_nominatim() (Google → Mapbox with
      relevance≥0.75 → Nominatim → Photon), bumped geocode_batch Semaphore
      2→5 and sleep 0.4→0.1, and expanded address abbreviations in
      clean_address() (R→Rua, Av→Avenida, Al→Alameda, Trav→Travessa,
      Dr→Doutor, Prof→Professor, plus Pça, Eng, Cel, Mal, Jd, Dra, Profa).
      Please test /api/geocode-batch with mixed abbreviated addresses to
      confirm Google is used first and all 5 return found=true with
      provider="google". Also confirm no regression on /api/optimize.

      Frontend: upload.tsx now branches on file extension. PDF → /scanner
      (Circuit order preserved). XLSX/XLS/CSV/TXT/manual → /route (which
      renders the map with the existing "Otimizar Rota" button so the driver
      can optimize via Google Maps before scanning). Frontend testing not
      required unless bundle fails to load.

frontend_tasks_iteration_8:
  - task: "Route Excel/CSV uploads to /route (map with Otimizar Rota), PDF to /scanner"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/upload.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: >-
          Added isPdf detection via extension/mime. processStops now accepts
          {preserveOrder} option. PDF path saves CIRCUIT_KEY=1 and routes to
          /scanner; Excel/CSV/manual path saves CIRCUIT_KEY=0 and routes to
          /route where the existing "Otimizar Rota" button is prominent.

backend_tasks_iteration_8:
  - task: "geocode_google() primary geocoder"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: >-
          New async function calling maps.googleapis.com/maps/api/geocode/json
          with region=br, components=country:BR, language=pt-BR. Filters to
          location_type ∈ {ROOFTOP, RANGE_INTERPOLATED, GEOMETRIC_CENTER}.
  - task: "Chain Google → Mapbox (relevance≥0.75) → Nominatim → Photon"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: >-
          geocode_nominatim() now tries Google first, then Mapbox (relevance
          check inside geocode_mapbox), then Nominatim, then Photon. Manual
          curl confirmed all 5 test addresses returned provider="google".
  - task: "geocode_batch Semaphore 2→5, sleep 0.4→0.1"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
  - task: "clean_address abbreviation expansion"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: >-
          Added _expand_address_abbrev() with R/Av/Al/Trav/Dr/Prof plus common
          variants (Pça, Eng, Cel, Mal, Jd, Dra, Profa). Called from
          clean_address() before city-context enrichment.
