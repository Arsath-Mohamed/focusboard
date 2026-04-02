# FocusBoard v13

This build upgrades FocusBoard from local `db.json` storage to MongoDB Atlas using Mongoose.

## What changed
- MongoDB Atlas + Mongoose integration
- `server.js` rewritten for collection-based storage
- Keeps your main auth + dashboard + tracking routes
- Optional one-time legacy migration route from `data/db.json`

## Setup
1. Run `npm install`
2. Copy `.env.example` to `.env`
3. Fill in:
   - `MONGO_URI`
   - `JWT_SECRET`
   - `ADMIN_MIGRATE_KEY`
4. Run `npm start`

## Optional legacy migration
If your old data is still in `data/db.json`, you can migrate it once:

- Start the server
- Send a POST request to:
  `/api/admin/migrate-legacy`
- Include header:
  `x-admin-key: <your ADMIN_MIGRATE_KEY>`

## Notes
- This zip upgrades the backend layer.
- You still need a valid MongoDB Atlas connection string.
- The optional migration route should be removed after use in production.
