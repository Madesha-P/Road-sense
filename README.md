# Road Sense

An AI-powered road condition monitoring system that detects potholes from images using computer vision and provides safe route planning.

## Features

- **Pothole Detection** – Upload a road image and get AI-based pothole/defect analysis using PIL/Pillow computer vision heuristics
- **Interactive Map** – View detected potholes with severity, scores, and location data (pre-seeded with Bengaluru, Karnataka data)
- **Safe Route Engine** – Compute safest, balanced, or fastest routes between two points, avoiding high-risk pothole areas
- **Driver Alerts** – Real-time proximity alerts for critical/high-risk potholes along your route
- **Predictive Analytics** – Degradation trends, environmental correlations, and infrastructure risk scoring
- **REST API** – Fully featured JSON API for integration with external apps

## Tech Stack

- **Backend:** Python, Flask, Flask-CORS
- **Image Analysis:** Pillow (PIL)
- **Frontend:** HTML, CSS, JavaScript (served via Flask templates)

## Getting Started

```bash
# Clone the repo
git clone https://github.com/your-username/road-sense.git
cd road-sense

# Install dependencies
pip install -r requirements.txt

# Run the server
python app.py
```

Open `http://localhost:5000` in your browser.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Web dashboard |
| `/api/diagnostics/upload-capture` | POST | Upload road image for pothole detection |
| `/api/hazards/live` | GET | Get all pothole records |
| `/api/routes/calculate-safe-path` | POST | Calculate safest/balanced/fastest route |
| `/driver-alert` | POST | Get alerts for nearby potholes |
| `/predictive-analysis` | POST | Get degradation trend data |
| `/api/karnataka/roads` | GET | Get potholes within Karnataka bounds |
| `/api/karnataka/road-score` | POST | Get road score for a specific location |

## License

MIT
