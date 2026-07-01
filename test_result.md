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
      Please test backend endpoints /api/optimize and /api/optimize-google with
      3-6 real São Paulo addresses (mix of lat/lon provided and geocode-only).
      Verify: (a) response 200, (b) used_google=true when applicable in
      /api/optimize-google, (c) /api/optimize returns metrics using Google's
      distance/duration when Google succeeds, (d) fallback to nearest-neighbor
      when Google key missing/invalid. Also test frontend by loading a fresh
      dev-session, uploading a Circuit PDF, then tapping 'Mapa' from landing —
      route screen should render and 'Otimizar Rota' should apply Google order.
