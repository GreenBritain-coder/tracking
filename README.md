# RM Tracking Status Checker

A web application for tracking Royal Mail packages with automatic status updates every 5 minutes. Support staff can add tracking numbers, organize them into boxes, and view analytics to understand delivery patterns.

## Features

- **Authentication**: User login system for support staff
- **Tracking Management**: Add tracking numbers manually or via bulk upload (CSV/paste)
- **Box Organization**: Assign tracking numbers to boxes (15-20 per box)
- **Automatic Status Updates**: Background job runs every 5 minutes to scrape Royal Mail website
- **Status Display**: Three states with color coding:
  - 🔴 Not scanned (red)
  - 🟡 Scanned by RM (yellow)
  - 🟢 Delivered (green)
- **Analytics Dashboard**: Show time differences between states (dropped → scanned → delivered) per box
- **Timestamps**: All status changes recorded with timestamps

## Technology Stack

- **Backend**: Node.js with Express and TypeScript
- **Frontend**: React with TypeScript
- **Database**: PostgreSQL
- **Web Scraping**: Puppeteer
- **Scheduling**: node-cron for 5-minute intervals
- **Authentication**: JWT tokens with bcrypt for passwords
- **Deployment**: Docker containers for Coolify hosting

## Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Docker and Docker Compose (for containerized deployment)

## Local Development Setup

### 1. Clone the repository

```bash
git clone <repository-url>
cd "Tracking Site"
```

### 2. Set up environment variables

**Backend** (`backend/.env`):
```env
DATABASE_URL=postgresql://user:password@localhost:5432/rm_tracking
JWT_SECRET=your-secret-key-here-change-in-production
PORT=3000
NODE_ENV=development
```

**Frontend** (`frontend/.env`):
```env
VITE_API_URL=http://localhost:3000/api
```

### 3. Install dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 4. Set up database

```bash
cd backend
npm run migrate
```

### 5. Run the application

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

The application will be available at:
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000

## Docker Deployment

### Using Docker Compose

1. Create a `.env` file in the root directory:
```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your-secure-password
POSTGRES_DB=rm_tracking
JWT_SECRET=your-secret-key-here
```

2. Build and start services:
```bash
docker-compose up -d
```

3. Run database migrations:
```bash
docker-compose exec backend npm run migrate
```

### Coolify Deployment

1. **Backend Service:**
   - Build context: `./backend`
   - Port: `3000`
   - Environment variables:
     - `DATABASE_URL`: Your PostgreSQL connection string
     - `JWT_SECRET`: Secret for JWT tokens
     - `NODE_ENV`: `production`
     - `PORT`: `3000`

2. **Frontend Service:**
   - Build context: `./frontend`
   - Port: `80`
   - Environment variables:
     - `VITE_API_URL`: Your backend API URL (e.g., `https://api.track.greenbritain.club/api`)

3. **PostgreSQL Database:**
   - Set up a PostgreSQL database service in Coolify
   - Use the connection string in the backend `DATABASE_URL`

4. **Domain Configuration:**
   - Configure `track.greenbritain.club` to point to the frontend service
   - Optionally set up a subdomain for the API (e.g., `api.track.greenbritain.club`)

## First User Setup

After deploying, you'll need to create the first user. You can do this by:

1. Using the registration endpoint:
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "securepassword"}'
```

Or add a user directly to the database:
```sql
INSERT INTO users (email, password_hash) 
VALUES ('admin@example.com', '$2b$10$...'); -- Use bcrypt to hash password
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login

### Tracking Numbers
- `GET /api/tracking/numbers` - Get all tracking numbers (optional `?boxId=X`)
- `POST /api/tracking/numbers` - Create single tracking number
- `POST /api/tracking/numbers/bulk` - Bulk create tracking numbers
- `DELETE /api/tracking/numbers/:id` - Delete tracking number

### Boxes
- `GET /api/tracking/boxes` - Get all boxes
- `POST /api/tracking/boxes` - Create box
- `DELETE /api/tracking/boxes/:id` - Delete box

### Analytics
- `GET /api/analytics/overview` - Get overall analytics
- `GET /api/analytics/boxes` - Get analytics for all boxes
- `GET /api/analytics/boxes/:boxId` - Get detailed analytics for a box

All endpoints except `/api/auth/*` require authentication via Bearer token.

## Project Structure

```
/
├── backend/
│   ├── src/
│   │   ├── server.ts              # Express server setup
│   │   ├── routes/                # API routes
│   │   ├── services/              # Business logic (scraper, scheduler)
│   │   ├── models/                # Database models
│   │   ├── middleware/            # Auth middleware
│   │   └── db/                    # Database connection and migrations
│   ├── package.json
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/            # React components
│   │   ├── contexts/              # React contexts (Auth)
│   │   ├── api/                   # API client
│   │   └── App.tsx
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

## Notes

- The Royal Mail scraper uses Puppeteer to navigate and parse tracking pages. The status mapping may need adjustment based on actual Royal Mail page structure.
- The scheduler runs every 5 minutes and processes tracking numbers in batches to avoid rate limiting.
- All status changes are logged in the `status_history` table for analytics.
- The application automatically creates initial status history entries when tracking numbers are added.

## License

ISC

