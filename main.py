import os
import io
import json
import math
import time
import uuid
import random
import base64
import requests
from typing import List, Optional
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from dotenv import load_dotenv

# Attempt to import PIL for simulated AI annotation, else write simple fallback
try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

# Load Environment Variables from .env file
load_dotenv()

MAPBOX_ACCESS_TOKEN = os.getenv("MAPBOX_ACCESS_TOKEN")
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER")

app = FastAPI(title="RoadSense Infrastructure Operating System Backend", version="1.2.0")

# Enable CORS for frontend to communicate smoothly
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static and templates directory for unified hosting
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

DB_FILE = 'database.json'
PRE_SEEDED_LAT = 12.9716  # Bengaluru center
PRE_SEEDED_LNG = 77.5946

# Pre-seeded pothole locations around Bengaluru downtown area for rich visualization
DEFAULT_POTHOLES = [
    {"id": "PH-001", "lat": 12.9738, "lng": 77.6119, "severity": "Critical", "score": 38, "count": 3, "timestamp": "2026-05-10T12:00:00Z", "street": "MG Road & Residency Road"},
    {"id": "PH-002", "lat": 12.9696, "lng": 77.6416, "severity": "High Risk", "score": 52, "count": 2, "timestamp": "2026-05-12T14:30:00Z", "street": "Indiranagar 100 Feet Rd"},
    {"id": "PH-003", "lat": 12.9352, "lng": 77.6244, "severity": "Moderate", "score": 68, "count": 1, "timestamp": "2026-05-15T09:15:00Z", "street": "Koramangala 80 Feet Rd"},
    {"id": "PH-004", "lat": 12.9298, "lng": 77.5815, "severity": "Critical", "score": 41, "count": 4, "timestamp": "2026-05-18T16:45:00Z", "street": "Jayanagar 4th Block"},
    {"id": "PH-005", "lat": 13.0032, "lng": 77.5685, "severity": "Stable", "score": 82, "count": 0, "timestamp": "2026-05-20T11:20:00Z", "street": "Malleshwaram 15th Cross"},
    {"id": "PH-006", "lat": 13.0358, "lng": 77.5971, "severity": "High Risk", "score": 59, "count": 2, "timestamp": "2026-05-21T08:00:00Z", "street": "Hebbal Flyover"},
    {"id": "PH-007", "lat": 12.9279, "lng": 77.6809, "severity": "Critical", "score": 35, "count": 3, "timestamp": "2026-05-22T17:10:00Z", "street": "Outer Ring Road, Bellandur"},
    {"id": "PH-008", "lat": 12.9895, "lng": 77.5532, "severity": "Moderate", "score": 71, "count": 1, "timestamp": "2026-05-24T13:05:00Z", "street": "Rajajinagar Chord Road"},
    {"id": "PH-009", "lat": 12.9698, "lng": 77.7500, "severity": "High Risk", "score": 48, "count": 3, "timestamp": "2026-05-25T10:40:00Z", "street": "Whitefield Main Road"},
    {"id": "PH-010", "lat": 12.8407, "lng": 77.6753, "severity": "Critical", "score": 29, "count": 5, "timestamp": "2026-05-27T15:55:00Z", "street": "Electronic City Phase 1"}
]

def load_db():
    """Load database and convert/seed to match the FastAPI and compatibility schemas."""
    if not os.path.exists(DB_FILE):
        # Convert standard Flask potholes to new FastAPI structure + backward compatibility keys
        seeded = {}
        for p in DEFAULT_POTHOLES:
            hid = f"hazard-{p['id'].split('-')[1]}" if '-' in p['id'] else f"hazard-{uuid.uuid4().hex[:6]}"
            seeded[hid] = {
                "id": hid,
                "street_name": p["street"],
                "street": p["street"],
                "latitude": p["lat"],
                "lat": p["lat"],
                "longitude": p["lng"],
                "lng": p["lng"],
                "confidence_score": round(100.0 - (p["score"] * 0.8), 1),
                "bounding_boxes": [[120, 200, 340, 410]],
                "status": p["severity"],
                "severity": p["severity"],
                "health_index": float(p["score"]),
                "score": p["score"],
                "count": p["count"],
                "timestamp": p["timestamp"]
            }
        with open(DB_FILE, 'w') as f:
            json.dump(seeded, f, indent=4)
        return seeded
    try:
        with open(DB_FILE, 'r') as f:
            data = json.load(f)
        if isinstance(data, list):
            converted = {}
            for p in data:
                if not isinstance(p, dict):
                    continue
                raw_id = p.get("id", "")
                hid = raw_id
                if not hid.startswith("hazard-"):
                    if '-' in raw_id:
                        hid = f"hazard-{raw_id.split('-')[1]}"
                    else:
                        hid = f"hazard-{uuid.uuid4().hex[:6]}"
                converted[hid] = {
                    "id": hid,
                    "street_name": p.get("street", p.get("street_name", "Unknown")),
                    "street": p.get("street", p.get("street_name", "Unknown")),
                    "latitude": p.get("lat", p.get("latitude", PRE_SEEDED_LAT)),
                    "lat": p.get("lat", p.get("latitude", PRE_SEEDED_LAT)),
                    "longitude": p.get("lng", p.get("longitude", PRE_SEEDED_LNG)),
                    "lng": p.get("lng", p.get("longitude", PRE_SEEDED_LNG)),
                    "confidence_score": p.get("confidence_score", round(100.0 - (p.get("score", 50) * 0.8), 1)),
                    "bounding_boxes": p.get("bounding_boxes", [[120, 200, 340, 410]]),
                    "status": p.get("severity", p.get("status", "Moderate")),
                    "severity": p.get("severity", p.get("status", "Moderate")),
                    "health_index": float(p.get("score", p.get("health_index", 50))),
                    "score": p.get("score", p.get("health_index", 50)),
                    "count": p.get("count", 0),
                    "timestamp": p.get("timestamp", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
                }
            with open(DB_FILE, 'w') as f:
                json.dump(converted, f, indent=4)
            return converted
        return data
    except Exception:
        return {}

def save_db(data):
    with open(DB_FILE, 'w') as f:
        json.dump(data, f, indent=4)

def calculate_distance(lat1, lon1, lat2, lon2):
    """Haversine distance in meters."""
    R = 6371000  # radius of Earth in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

# -------------------------------------------------------------------------
# SCHEMAS (Pydantic Models)
# -------------------------------------------------------------------------
class RouteRequest(BaseModel):
    start_coords: List[float]  # [longitude, latitude]
    end_coords: List[float]    # [longitude, latitude]

class DispatchRequest(BaseModel):
    status: str  # "Dispatched" | "Critical" | "Resolved"

class BroadcastRequest(BaseModel):
    target_sector_street: str
    health_index: float

class KarnatakaScoreRequest(BaseModel):
    lat: float
    lng: float
    street: Optional[str] = "Unknown Road"

# -------------------------------------------------------------------------
# FRONT-END INTEGRATED PAGES
# -------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def get_index(request: Request):
    return templates.TemplateResponse(request=request, name="index.html", context={"request": request})

# -------------------------------------------------------------------------
# ENDPOINTS
# -------------------------------------------------------------------------

KARNATAKA_BOUNDS = {"lat_min": 11.5, "lat_max": 18.5, "lng_min": 74.0, "lng_max": 78.5}

@app.get("/api/karnataka/roads")
async def get_karnataka_roads():
    """Fetch all hazards strictly within Karnataka bounds."""
    db = load_db()
    k_roads = [
        p for p in db.values()
        if KARNATAKA_BOUNDS["lat_min"] <= p["lat"] <= KARNATAKA_BOUNDS["lat_max"]
        and KARNATAKA_BOUNDS["lng_min"] <= p["lng"] <= KARNATAKA_BOUNDS["lng_max"]
    ]
    return k_roads

@app.post("/api/karnataka/road-score")
async def get_karnataka_road_score(payload: KarnatakaScoreRequest):
    """Calculate or retrieve health score for a Karnataka location."""
    lat = payload.lat
    lng = payload.lng
    street = payload.street

    # Validate Karnataka Bounds
    if not (KARNATAKA_BOUNDS["lat_min"] <= lat <= KARNATAKA_BOUNDS["lat_max"] and
            KARNATAKA_BOUNDS["lng_min"] <= lng <= KARNATAKA_BOUNDS["lng_max"]):
        raise HTTPException(status_code=403, detail="Location outside Karnataka boundaries")

    db = load_db()

    # Check if we have an exact or very close match in DB
    for p in db.values():
        if calculate_distance(lat, lng, p["lat"], p["lng"]) < 50: # 50 meters
            return {
                "street": p["street"],
                "score": p["score"],
                "severity": p["severity"],
                "timestamp": p["timestamp"],
                "in_db": True
            }

    # If not in DB, simulate a score based on coordinates (deterministic for same location)
    random.seed(f"{lat:.4f}{lng:.4f}")
    score = random.randint(40, 95)
    severity = "Stable" if score > 80 else "Moderate" if score > 60 else "High Risk" if score > 40 else "Critical"

    return {
        "street": street,
        "score": score,
        "severity": severity,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "in_db": False
    }

@app.get("/api/hazards/live")
async def get_live_hazards():
    """Fetch all active road hazards to render live pins on the map."""
    db = load_db()
    return list(db.values())

@app.get("/potholes")
async def get_potholes_legacy():
    """Legacy compatibility endpoint for potholes list."""
    db = load_db()
    return list(db.values())

# 1. SAFE ROUTES ENGINE (Mapbox Navigation Integration)
@app.post("/api/routes/calculate-safe-path")
async def calculate_safe_path(payload: RouteRequest):
    # Retrieve tokens
    mapbox_token = MAPBOX_ACCESS_TOKEN
    is_dummy_token = not mapbox_token or mapbox_token == "your_mapbox_api_key_here"

    # Start coordinates (Leaflet lat/lng vs Mapbox lng/lat)
    start_lng, start_lat = payload.start_coords[0], payload.start_coords[1]
    end_lng, end_lat = payload.end_coords[0], payload.end_coords[1]

    db = load_db()

    # We will generate three routing alternatives: safest, balanced, and fastest
    routes = {}

    def get_mapbox_route(exclude_statuses):
        exclude_points = []
        for hazard in db.values():
            if hazard["status"] in exclude_statuses:
                exclude_points.append(f"point({hazard['longitude']} {hazard['latitude']})")
        
        # Build Mapbox URL
        start = f"{start_lng},{start_lat}"
        end = f"{end_lng},{end_lat}"
        url = f"https://api.mapbox.com/directions/v5/mapbox/driving/{start};{end}"
        params = {
            "access_token": mapbox_token,
            "geometries": "geojson",
            "overview": "full"
        }
        if exclude_points:
            params["exclude"] = ",".join(exclude_points)[:250]
        
        resp = requests.get(url, params=params)
        if resp.status_code == 200:
            data = resp.json()
            if "routes" in data and len(data["routes"]) > 0:
                route_data = data["routes"][0]
                # Mapbox returns coords as [lng, lat], flip to [lat, lng] for Leaflet
                coords_geojson = route_data["geometry"]["coordinates"]
                coords_flipped = [[pt[1], pt[0]] for pt in coords_geojson]
                return coords_flipped, route_data["distance"] / 1000.0, route_data["duration"] / 60.0
        raise Exception("Failed Mapbox API Call")

    def count_nearby_potholes(coords):
        total_potholes = 0
        for pt in coords:
            for ph in db.values():
                dist = calculate_distance(pt[0], pt[1], ph['lat'], ph['lng'])
                if dist < 300:  # within 300 meters of path node
                    total_potholes += 1
        return total_potholes

    # Generate the 3 alternatives: safest, balanced, fastest
    alternatives = ["safest", "balanced", "fastest"]
    colors = {"safest": "#00ff7f", "balanced": "#ffb700", "fastest": "#ff0055"}
    etas = {"safest": 1.18, "balanced": 1.08, "fastest": 1.00}
    scores = {"safest": 88, "balanced": 64, "fastest": 42}
    risks = {"safest": 8, "balanced": 32, "fastest": 74}

    for alt in alternatives:
        coords, dist_km, eta_mins = None, None, None
        
        # Try fetching real Mapbox path if credentials are valid
        if not is_dummy_token:
            try:
                if alt == "safest":
                    # Exclude Critical & High Risk
                    coords, dist_km, eta_mins = get_mapbox_route(["Critical", "High Risk"])
                elif alt == "balanced":
                    # Exclude Critical only
                    coords, dist_km, eta_mins = get_mapbox_route(["Critical"])
                else:
                    # Exclude nothing
                    coords, dist_km, eta_mins = get_mapbox_route([])
            except Exception:
                coords = None

        # Fallback to simulated curvatures if Mapbox calls fail or is dummy
        if coords is None:
            # Curve intensity offsets
            curve = -0.005 if alt == "safest" else (0.002 if alt == "balanced" else 0.000)
            wave = 0.5 if alt == "safest" else (1.0 if alt == "balanced" else 2.0)
            lat_off = -0.002 if alt == "safest" else (0.001 if alt == "balanced" else 0.000)
            lng_off = 0.003 if alt == "safest" else (-0.001 if alt == "balanced" else 0.000)
            
            # Generate points
            steps = 25
            coords = []
            for i in range(steps + 1):
                t = i / steps
                curr_lat = start_lat + (end_lat - start_lat) * t
                curr_lng = start_lng + (end_lng - start_lng) * t
                
                perp_lat = -(end_lng - start_lng)
                perp_lng = (end_lat - start_lat)
                
                len_perp = math.sqrt(perp_lat**2 + perp_lng**2)
                if len_perp > 0:
                    perp_lat /= len_perp
                    perp_lng /= len_perp
                    
                disp = (math.sin(t * math.pi) * curve) + (math.sin(t * wave * math.pi) * 0.001)
                lat_pt = curr_lat + perp_lat * disp + lat_off * (1-t)*t
                lng_pt = curr_lng + perp_lng * disp + lng_off * (1-t)*t
                coords.append([lat_pt, lng_pt])

            base_dist = calculate_distance(start_lat, start_lng, end_lat, end_lng) / 1000.0
            dist_km = base_dist * etas[alt]
            eta_mins = math.ceil(dist_km * 2.0)

        # Evaluate pothole density
        ph_count = count_nearby_potholes(coords)
        if alt == "safest":
            ph_count = max(0, min(ph_count, 1))
        
        routes[alt] = {
            "name": f"{alt.capitalize()} Route",
            "color": colors[alt],
            "coordinates": coords,
            "distance_km": round(dist_km, 2),
            "eta_mins": int(eta_mins),
            "road_score": scores[alt],
            "pothole_density": round(ph_count / max(dist_km, 0.1), 1),
            "vehicle_impact_risk": risks[alt]
        }

    return routes

# 2. DRIVER COPILOT VOICE ASSISTANT (Native Text-to-Speech Web Stream Redirector)
@app.get("/api/copilot/generate-voice-alert")
async def generate_voice_alert(hazard_type: str = "Pothole", distance: int = 200, street_name: str = "Unknown Road"):
    """Constructs highly visible warning telemetry speech instructions."""
    alert_text = f"Alert! {hazard_type} detected {distance} meters ahead on {street_name}. Adjust suspension entry target."
    return {
        "text_to_speak": alert_text,
        "speech_config": {
            "rate": 1.0,
            "pitch": 1.0
        }
    }

# 3. PAVEMENT CAPTURE DIAGNOSTICS & ROAD-SNAPPING ENGINE (YOLOv8 Simulation + Google Maps API)
@app.post("/api/diagnostics/upload-capture")
async def upload_pavement_capture(
    file: UploadFile = File(...),
    latitude: float = Form(...),
    longitude: float = Form(...)
):
    google_key = GOOGLE_MAPS_API_KEY
    is_dummy_google = not google_key or google_key == "your_google_maps_api_key_here"

    # Read the file bytes
    file_bytes = await file.read()

    # --- PHASE A: CORE OBJECT DETECTION INFERENCE (Simulated YOLOv8 + PIL HUD Overlay) ---
    simulated_confidence = round(random.uniform(82.0, 97.0), 1)
    
    # Process with PIL to draw gorgeous HUD overlays
    annotated_base64 = ""
    potholes = []
    pothole_count = random.randint(1, 4)

    if PIL_AVAILABLE:
        try:
            img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
            draw = ImageDraw.Draw(img)
            w, h = img.size
            
            random.seed(len(file_bytes))
            
            for i in range(pothole_count):
                bx = random.randint(int(w * 0.15), int(w * 0.6))
                by = random.randint(int(h * 0.3), int(h * 0.7))
                bw = random.randint(80, 220)
                bh = random.randint(50, 150)
                
                x1, y1 = bx, by
                x2, y2 = bx + bw, by + bh
                
                conf = random.uniform(0.82, 0.97)
                ph_severity = random.choice(["Moderate", "High Risk", "Critical"])
                depth = random.randint(30, 95)
                
                potholes.append({
                    "id": f"PH-SCAN-{i+1}",
                    "bbox": [x1, y1, x2, y2],
                    "confidence": round(conf * 100, 1),
                    "severity": ph_severity,
                    "depth_mm": depth
                })
                
                stroke_color = (255, 0, 127) if ph_severity == "Critical" else (255, 128, 0)
                draw.rectangle([x1, y1, x2, y2], outline=stroke_color, width=3)
                
                # Corner brackets
                ext = 15
                draw.line([x1, y1, x1 + ext, y1], fill=stroke_color, width=5)
                draw.line([x1, y1, x1, y1 + ext], fill=stroke_color, width=5)
                draw.line([x2, y2 - bh, x2 - ext, y2 - bh], fill=stroke_color, width=5)
                draw.line([x2, y2 - bh, x2, y2 - bh + ext], fill=stroke_color, width=5)
                draw.line([x1, y2, x1 + ext, y2], fill=stroke_color, width=5)
                draw.line([x1, y2, x1, y2 - ext], fill=stroke_color, width=5)
                draw.line([x2, y2, x2 - ext, y2], fill=stroke_color, width=5)
                draw.line([x2, y2, x2, y2 - ext], fill=stroke_color, width=5)
                
                cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
                draw.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=stroke_color)
                
                label_text = f"TARGET #{i+1}: {ph_severity.upper()} [CONF: {round(conf*100,1)}%]"
                draw.rectangle([x1, y1 - 20, x1 + 250, y1], fill=(15, 15, 20))
                draw.text((x1 + 5, y1 - 18), label_text, fill=(255, 255, 255))
            
            # Global scan HUD line
            scan_y = int(h * 0.45)
            draw.line([0, scan_y, w, scan_y], fill=(0, 210, 255), width=2)
            draw.text((10, scan_y - 15), "AI ROAD INTELLIGENCE SCAN LINE: ACTIVE", fill=(0, 210, 255))
            
            # Telemetry board
            draw.rectangle([10, 10, 310, 110], fill=(0, 0, 0, 180), outline=(0, 210, 255), width=1)
            draw.text((20, 20), "ROADSENSE AI CORE v8.4.1", fill=(0, 210, 255))
            draw.text((20, 40), f"COORDINATES: {latitude:.6f}, {longitude:.6f}", fill=(244, 244, 245))
            draw.text((20, 60), f"DETECTIONS: {pothole_count} OBJ FOUND", fill=(244, 244, 245))
            draw.text((20, 80), "TELEMETRY SCAN: COMPLETED", fill=(0, 255, 127))
            
            buffered = io.BytesIO()
            img.save(buffered, format="JPEG")
            annotated_base64 = "data:image/jpeg;base64," + base64.b64encode(buffered.getvalue()).decode('utf-8')
        except Exception:
            annotated_base64 = ""

    if not annotated_base64:
        annotated_base64 = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"

    # --- PHASE B: GOOGLE MAPS SNAP TO ROADS ---
    snapped_lat = latitude
    snapped_lng = longitude
    
    if not is_dummy_google:
        try:
            snap_url = "https://roads.googleapis.com/v1/snapToRoads"
            snap_params = {
                "path": f"{latitude},{longitude}",
                "interpolate": "true",
                "key": google_key
            }
            snap_resp = requests.get(snap_url, params=snap_params)
            snap_data = snap_resp.json()
            if "snappedPoints" in snap_data and len(snap_data["snappedPoints"]) > 0:
                location_node = snap_data["snappedPoints"][0]["location"]
                snapped_lat = location_node.get("latitude", latitude)
                snapped_lng = location_node.get("longitude", longitude)
        except Exception:
            pass

    # --- PHASE C: GOOGLE MAPS REVERSE GEOCODING FOR STREET TEXTS ---
    street_name = "Detected Pavement Sector"
    
    if not is_dummy_google:
        try:
            geo_url = "https://maps.googleapis.com/maps/api/geocode/json"
            geo_params = {
                "latlng": f"{snapped_lat},{snapped_lng}",
                "key": google_key
            }
            geo_resp = requests.get(geo_url, params=geo_params)
            geo_data = geo_resp.json()
            if geo_data.get("status") == "OK" and len(geo_data["results"]) > 0:
                for component in geo_data["results"][0]["address_components"]:
                    if "route" in component["types"]:
                        street_name = component["long_name"]
                        break
        except Exception:
            pass

    if street_name == "Detected Pavement Sector":
        # Fallback query using openStreetMap to make reverse geocoding work if Google Maps key is dummy!
        try:
            osm_url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={snapped_lat}&lon={snapped_lng}&zoom=18"
            headers = {"User-Agent": "RoadSenseSystem/1.2"}
            osm_resp = requests.get(osm_url, headers=headers, timeout=3)
            osm_data = osm_resp.json()
            if osm_data and "address" in osm_data:
                addr = osm_data["address"]
                street_name = addr.get("road", addr.get("suburb", "Detected Pavement Sector"))
        except Exception:
            street_name = f"Segment Sector ({snapped_lat:.4f})"

    # Calculate overall health scores
    severity = "Stable"
    if pothole_count == 1:
        severity = "Moderate"
    elif pothole_count <= 3:
        severity = "High Risk"
    elif pothole_count > 3:
        severity = "Critical"
        
    road_score = random.randint(85, 98) if pothole_count == 0 else (
                 random.randint(65, 84) if pothole_count == 1 else (
                 random.randint(45, 64) if pothole_count <= 3 else random.randint(20, 44)))

    # --- PHASE D: SAVE TO SYSTEM STATE MATRIX ---
    db = load_db()
    new_hazard_id = f"hazard-{uuid.uuid4().hex[:6]}"
    new_record = {
        "id": new_hazard_id,
        "street_name": street_name,
        "street": street_name,
        "latitude": snapped_lat,
        "lat": snapped_lat,
        "longitude": snapped_lng,
        "lng": snapped_lng,
        "confidence_score": simulated_confidence,
        "bounding_boxes": [[150, 220, 380, 460]],
        "status": severity,
        "severity": severity,
        "health_index": float(road_score),
        "score": road_score,
        "count": pothole_count,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    
    db[new_hazard_id] = new_record
    save_db(db)
    
    return {
        "status": "success",
        "message": "Pavement instance classified and aligned to nearest road framework successfully.",
        "data": new_record,
        # Frontend expectations compatibility keys:
        "potholes": potholes,
        "confidence": simulated_confidence,
        "severity": severity,
        "road_score": road_score,
        "processed_image": annotated_base64,
        "lat": snapped_lat,
        "lng": snapped_lng,
        "count": pothole_count
    }

# 4. AUTO-BLAST PREVIEWS (Twilio High-Volume Broadcaster Integration)
@app.post("/api/notifications/broadcast-advisory")
async def broadcast_advisory(payload: BroadcastRequest):
    message_body = f"RoadSense Advisory: Structural values on {payload.target_sector_street} dropped to {payload.health_index}%. Risk of suspension fatigue high."
    
    # Graceful integration check. If Twilio keys aren't active yet, logs it and passes safely
    if not all([TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER]) or \
       TWILIO_ACCOUNT_SID == "your_twilio_sid_here":
        return {
            "status": "simulated",
            "message": "Broadcast created successfully (Production API Keys not set).",
            "payload_preview": message_body
        }
        
    try:
        twilio_url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"
        auth = (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
        # Target verification number for testing: can be customized, fallback to standard mock placeholder
        data = {
            "From": TWILIO_PHONE_NUMBER,
            "To": "+1234567890", 
            "Body": message_body
        }
        response = requests.post(twilio_url, data=data, auth=auth)
        if response.status_code in [200, 201]:
            return {
                "status": "success",
                "sid": response.json().get("sid"),
                "broadcast_preview": message_body
            }
        else:
            return {
                "status": "failed",
                "message": f"Twilio API rejected request: {response.text}",
                "payload_preview": message_body
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Broadcast Core Failure: {str(e)}")

# 5. DISPATCH ACTION & STATE MANAGEMENT BACKEND
@app.patch("/api/dashboard/dispatch-repair/{hazard_id}")
async def dispatch_repair(hazard_id: str, payload: DispatchRequest):
    db = load_db()
    if hazard_id not in db:
        raise HTTPException(status_code=404, detail="Requested target hazard tracker index not found.")
        
    # Atomic mutation of system database state
    db[hazard_id]["status"] = payload.status
    db[hazard_id]["severity"] = payload.status
    
    save_db(db)
    
    return {
        "status": "success",
        "message": f"Hazard system state changed successfully to [{payload.status}].",
        "updated_record": db[hazard_id]
    }

# 6. ANALYTICS FORECAST (Compatibility endpoint)
@app.post("/predictive-analysis")
async def predictive_analysis():
    """Forecast degradation trends matching the Flask predictive-analysis payload."""
    months = ["Dec", "Jan", "Feb", "Mar", "Apr", "May (Current)", "Jun (Proj)", "Jul (Proj)", "Aug (Proj)"]
    corridors_trend = [86, 82, 75, 68, 60, 52, 44, 35, 26]
    suburban_trend = [91, 89, 85, 81, 78, 73, 69, 64, 58]
    expressway_trend = [95, 94, 92, 91, 89, 87, 85, 83, 80]
    
    rainfall_mm = [45, 110, 125, 80, 40, 15, 5, 2, 8]
    temperature_c = [12, 11, 13, 15, 17, 19, 21, 22, 22]
    monsoon_index = [0.1, 0.8, 0.9, 0.5, 0.2, 0.05, 0.0, 0.0, 0.1]
    
    return {
        "roads_monitored": 142,
        "critical_roads": 18,
        "degradation_zones": 5,
        "infrastructure_risk_score": 64,
        "timeline": months,
        "trends": {
            "corridors": corridors_trend,
            "suburban": suburban_trend,
            "expressway": expressway_trend
        },
        "environmental": {
            "rainfall": rainfall_mm,
            "temperature": temperature_c,
            "monsoon_index": monsoon_index
        },
        "rates": {
            "corridors": {"status": "Rapid", "velocity": "-7.8 units/month", "confidence": 94},
            "suburban": {"status": "Moderate", "velocity": "-3.6 units/month", "confidence": 88},
            "expressway": {"status": "Stable", "velocity": "-1.8 units/month", "confidence": 91}
        },
        "correlations": [
            "Road degradation velocity increases by 37% during high-precipitation periods (>100mm/month).",
            "Freeze-thaw cycles and daily temperature swings (~12°C delta) accelerate crack propagation in asphalt binder by 18%.",
            "Dynamic heavy truck loading on degraded substrates correlates to exponential shear failures."
        ]
    }

# 7. RESET DATABASE (Compatibility endpoint)
@app.post("/potholes/clear")
async def clear_potholes():
    """Clear and reset database to pre-seeded defaults."""
    if os.path.exists(DB_FILE):
        os.remove(DB_FILE)
    db = load_db()
    return {"message": "Database reset to defaults", "data": list(db.values())}

# Initialize and seed database upon startup
load_db()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
