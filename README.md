# FocusBoard v12

A SaaS-ready multi-user productivity dashboard foundation built with Node.js, Express, local JSON persistence, and a polished multi-page UI.

## What changed in v12
- removed single-user assumptions
- added multi-user register/login flow
- isolated all data per user
- removed terminal entirely
- kept the product focused on study, fitness, projects, analytics, profile, and settings
- made the product positioning more SaaS-friendly and less personal

## Pages
- Login
- Register
- Dashboard
- Study
- Fitness
- Projects
- Analytics
- Profile
- Settings

## Run locally
```bash
npm install
npm start
```

Open:
```text
http://localhost:3000
```

## Environment variables
Copy `.env.example` to `.env` and set your production values.

## Notes
- Data is stored in `data/db.json`
- This is a strong SaaS base, but not billing-enabled yet
- Good next step: MongoDB, email verification, billing, and team workspaces
